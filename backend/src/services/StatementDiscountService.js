const StatementDiscount = require('../models/StatementDiscount');
const Week = require('../models/Week');
const { normalizePeriodKey } = require('../helpers/StatementNumberHelper');
const { startOfDay } = require('../helpers/DateHelper');

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function discountKey(userKey, periodType, periodKey) {
  const type = periodType === 'month' ? 'month' : 'week';
  return `${String(userKey)}|${type}|${normalizePeriodKey(type, periodKey)}`;
}

function applyDiscountToAmounts({
  grossTotal = 0,
  organizationAmount = 0,
  personalAmount = 0,
  discountPercent = 0,
} = {}) {
  const percent = clampPercent(discountPercent);
  const personalBefore = Math.max(0, Number(personalAmount) || 0);
  const org = Math.max(0, Number(organizationAmount) || 0);
  const gross = Math.max(0, Number(grossTotal) || 0);
  const discountAmount = Math.round(personalBefore * percent / 100);
  const personalAfter = Math.max(0, personalBefore - discountAmount);
  return {
    discountPercent: percent,
    discountAmount,
    personalAmountBefore: personalBefore,
    personalAmount: personalAfter,
    organizationAmount: org,
    // Gross bill after personal discount (org share unchanged)
    grossTotal: org + personalAfter,
    grossTotalBefore: gross || (org + personalBefore),
  };
}

function applyDiscountMapToRow(row, discountMap, periodType, periodKey) {
  const key = discountKey(row.userKey, periodType, periodKey);
  const stored = discountMap.get(key);
  const percent = stored ? clampPercent(stored.discountPercent) : 0;
  const applied = applyDiscountToAmounts({
    grossTotal: row.grossTotal,
    organizationAmount: row.organizationAmount,
    personalAmount: row.personalAmount,
    discountPercent: percent,
  });
  return {
    ...row,
    ...applied,
    discountNote: stored?.note || '',
    hasDiscount: percent > 0,
  };
}

/**
 * Apply a fixed discount amount (e.g. sum of weekly discounts) onto a finance row,
 * then optionally stack a period percent (month-level) on the remaining personal share.
 */
function applyStackedDiscountsToRow(row, {
  fixedDiscountAmount = 0,
  periodPercent = 0,
  periodNote = '',
} = {}) {
  const org = Math.max(0, Number(row.organizationAmount) || 0);
  const personalBefore = Math.max(0, Number(row.personalAmountBefore ?? row.personalAmount) || 0);
  const grossBefore = Math.max(
    0,
    Number(row.grossTotalBefore ?? row.grossTotal) || (org + personalBefore),
  );

  const fixed = Math.min(personalBefore, Math.max(0, Math.round(Number(fixedDiscountAmount) || 0)));
  const afterFixed = Math.max(0, personalBefore - fixed);
  const percent = clampPercent(periodPercent);
  const percentDisc = Math.round(afterFixed * percent / 100);
  const personalAfter = Math.max(0, afterFixed - percentDisc);
  const discountAmount = fixed + percentDisc;

  return {
    ...row,
    discountPercent: percent,
    discountAmount,
    weeklyDiscountAmount: fixed,
    personalAmountBefore: personalBefore,
    personalAmount: personalAfter,
    organizationAmount: org,
    grossTotal: org + personalAfter,
    grossTotalBefore: grossBefore,
    discountNote: periodNote || row.discountNote || '',
    hasDiscount: discountAmount > 0,
  };
}

async function loadDiscountMap(periodType, periodKey) {
  const type = periodType === 'month' ? 'month' : 'week';
  const key = normalizePeriodKey(type, periodKey);
  const rows = await StatementDiscount.find({ periodType: type, periodKey: key }).lean();
  const map = new Map();
  rows.forEach((row) => {
    map.set(discountKey(row.userKey, row.periodType, row.periodKey), row);
  });
  return map;
}

async function loadWeekDiscountRows(weekIds = []) {
  const ids = [...new Set((weekIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return [];
  return StatementDiscount.find({
    periodType: 'week',
    periodKey: { $in: ids },
  }).lean();
}

async function findWeeksOverlappingRange(rangeStart, rangeEnd) {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  if (!start || !end || start > end) return [];
  return Week.find({
    startDate: { $lte: end },
    endDate: { $gte: start },
  }).select('_id startDate endDate').lean();
}

/**
 * For each overlapping week that has a stored discount, call `summarizeSlice(start, end)`
 * and accumulate personal-share discounts per userKey.
 *
 * summarizeSlice must return { byUserKey: Map|Object of userKey -> personalAmount }
 * or an array of { userKey, personalAmount }.
 */
async function accumulateWeeklyPersonalDiscounts({
  rangeStart,
  rangeEnd,
  summarizeSlice,
}) {
  const weeks = await findWeeksOverlappingRange(rangeStart, rangeEnd);
  if (!weeks.length) return new Map();

  const weekIds = weeks.map((w) => String(w._id));
  const discountRows = await loadWeekDiscountRows(weekIds);
  if (!discountRows.length) return new Map();

  const percentByUserWeek = new Map();
  discountRows.forEach((row) => {
    percentByUserWeek.set(
      `${String(row.userKey)}|${String(row.periodKey)}`,
      clampPercent(row.discountPercent),
    );
  });

  const weeksWithDiscount = new Set(discountRows.map((r) => String(r.periodKey)));
  const discountByUser = new Map();

  for (const week of weeks) {
    const weekId = String(week._id);
    if (!weeksWithDiscount.has(weekId)) continue;

    const sliceStart = startOfDay(new Date(Math.max(+startOfDay(week.startDate), +startOfDay(rangeStart))));
    const sliceEnd = startOfDay(new Date(Math.min(+startOfDay(week.endDate), +startOfDay(rangeEnd))));
    if (sliceStart > sliceEnd) continue;

    const slice = await summarizeSlice(sliceStart, sliceEnd, weekId);
    const entries = normalizeSliceEntries(slice);

    for (const { userKey, personalAmount } of entries) {
      const pct = percentByUserWeek.get(`${userKey}|${weekId}`) || 0;
      if (pct <= 0) continue;
      const personal = Math.max(0, Number(personalAmount) || 0);
      if (personal <= 0) continue;
      const amount = Math.round(personal * pct / 100);
      if (amount <= 0) continue;
      discountByUser.set(userKey, (discountByUser.get(userKey) || 0) + amount);
    }
  }

  return discountByUser;
}

function normalizeSliceEntries(slice) {
  if (!slice) return [];
  if (Array.isArray(slice)) {
    return slice.map((item) => ({
      userKey: String(item.userKey),
      personalAmount: Number(item.personalAmount) || 0,
    }));
  }
  if (slice.byUserKey instanceof Map) {
    return [...slice.byUserKey.entries()].map(([userKey, personalAmount]) => ({
      userKey: String(userKey),
      personalAmount: Number(personalAmount) || 0,
    }));
  }
  if (slice.byUserKey && typeof slice.byUserKey === 'object') {
    return Object.entries(slice.byUserKey).map(([userKey, personalAmount]) => ({
      userKey: String(userKey),
      personalAmount: Number(personalAmount) || 0,
    }));
  }
  return [];
}

async function getDiscount(userKey, periodType, periodKey) {
  const type = periodType === 'month' ? 'month' : 'week';
  const key = normalizePeriodKey(type, periodKey);
  return StatementDiscount.findOne({
    userKey: String(userKey),
    periodType: type,
    periodKey: key,
  }).lean();
}

async function upsertDiscount({
  userKey,
  periodType,
  periodKey,
  discountPercent,
  note = '',
  updatedBy = '',
}) {
  const type = periodType === 'month' ? 'month' : 'week';
  const key = normalizePeriodKey(type, periodKey);
  const percent = clampPercent(discountPercent);

  if (percent <= 0) {
    await StatementDiscount.deleteOne({
      userKey: String(userKey),
      periodType: type,
      periodKey: key,
    });
    return { deleted: true, discountPercent: 0 };
  }

  const doc = await StatementDiscount.findOneAndUpdate(
    { userKey: String(userKey), periodType: type, periodKey: key },
    {
      $set: {
        discountPercent: percent,
        note: String(note || '').slice(0, 300),
        updatedBy: String(updatedBy || '').slice(0, 120),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return doc;
}

function summarizeDiscountedRows(rows = []) {
  return rows.reduce((acc, row) => {
    if (row.kind === 'guest') acc.guestCount += 1;
    else acc.userCount += 1;
    acc.mealCount += Number(row.mealCount || 0);
    acc.grossTotal += Number(row.grossTotal || 0);
    acc.grossTotalBefore += Number(row.grossTotalBefore || row.grossTotal || 0);
    acc.organizationAmount += Number(row.organizationAmount || 0);
    acc.personalAmount += Number(row.personalAmount || 0);
    acc.personalAmountBefore += Number(row.personalAmountBefore || row.personalAmount || 0);
    acc.discountAmount += Number(row.discountAmount || 0);
    return acc;
  }, {
    userCount: 0,
    guestCount: 0,
    mealCount: 0,
    grossTotal: 0,
    grossTotalBefore: 0,
    organizationAmount: 0,
    personalAmount: 0,
    personalAmountBefore: 0,
    discountAmount: 0,
  });
}

module.exports = {
  clampPercent,
  discountKey,
  applyDiscountToAmounts,
  applyDiscountMapToRow,
  applyStackedDiscountsToRow,
  loadDiscountMap,
  loadWeekDiscountRows,
  findWeeksOverlappingRange,
  accumulateWeeklyPersonalDiscounts,
  getDiscount,
  upsertDiscount,
  summarizeDiscountedRows,
};
