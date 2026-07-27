const StatementDiscount = require('../models/StatementDiscount');
const { normalizePeriodKey } = require('../helpers/StatementNumberHelper');

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
  loadDiscountMap,
  getDiscount,
  upsertDiscount,
  summarizeDiscountedRows,
};
