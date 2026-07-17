const Order = require('../models/Order');
const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const {
  startOfDay,
  formatJalaliDate,
  parseJalaliDate,
} = require('../helpers/DateHelper');
const { buildStatementNumber } = require('../helpers/StatementNumberHelper');
const { finalizeExpiredOrders } = require('../helpers/OrderStatusHelper');
const { buildOrderOwnerFilter } = require('../helpers/AuthUserHelper');
const {
  resolveReportRange,
  isConfirmedReportOrder,
  CONFIRMED_REPORT_STATUSES,
} = require('../services/ReportService');

const persianMonthNames = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

function endOfRange(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function normalizeReportDigits(value) {
  const map = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value).replace(/[۰-۹٠-٩]/g, (digit) => map[digit] || digit);
}

function getJalaliYearMonth(date) {
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(date));
  const pick = (type) => Number(normalizeReportDigits(parts.find((part) => part.type === type)?.value || '0'));
  return { year: pick('year'), month: pick('month') };
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function splitAmount(totalPrice, organizationSharePercent) {
  const total = Math.max(0, Number(totalPrice) || 0);
  const orgPercent = clampPercent(organizationSharePercent);
  const organizationAmount = Math.round(total * orgPercent / 100);
  const personalAmount = total - organizationAmount;
  return { total, organizationAmount, personalAmount };
}

function orderFoodName(order) {
  return order.menuItemId?.foodId?.name
    || order.items?.map((item) => item.foodId?.name).filter(Boolean).join('، ')
    || '-';
}

function orderMealCount(order) {
  return order.quantity || order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 1;
}

function reportDateOfOrder(order) {
  return startOfDay(order.menuItemId?.dailyMenuId?.date || order.orderDate);
}

function jalaliMonthRangeValue(year, month) {
  const monthText = String(month).padStart(2, '0');
  const lastDay = month <= 6 ? 31 : (month <= 11 ? 30 : 29);
  return {
    key: `${year}-${monthText}`,
    label: `${persianMonthNames[month - 1]} ${year}`,
    from: `${year}/${monthText}/01`,
    to: `${year}/${monthText}/${lastDay}`,
  };
}

async function findUserOrdersInRange(user, rangeStartInput, rangeEndInput) {
  const rangeStart = startOfDay(rangeStartInput);
  const rangeEnd = endOfRange(rangeEndInput);
  const ownerFilter = await buildOrderOwnerFilter(user);

  const dailyMenus = await DailyMenu.find({
    date: { $gte: rangeStart, $lte: rangeEnd },
  }).select('_id').lean();
  const menuItems = dailyMenus.length
    ? await MenuItem.find({ dailyMenuId: { $in: dailyMenus.map((m) => m._id) } }).select('_id').lean()
    : [];

  const orConditions = [{ orderDate: { $gte: rangeStart, $lte: rangeEnd } }];
  if (menuItems.length) {
    orConditions.push({ menuItemId: { $in: menuItems.map((m) => m._id) } });
  }

  return Order.find({
    $and: [
      ownerFilter,
      { status: { $in: CONFIRMED_REPORT_STATUSES } },
      { $or: orConditions },
    ],
  })
    .sort({ orderDate: -1 })
    .populate('items.foodId', 'name')
    .populate({
      path: 'menuItemId',
      populate: [{ path: 'foodId', select: 'name' }, { path: 'dailyMenuId', select: 'date' }],
    })
    .lean();
}

async function summarizeUserOrdersInRange(user, rangeStartInput, rangeEndInput, organizationSharePercent) {
  const candidateOrders = await findUserOrdersInRange(user, rangeStartInput, rangeEndInput);
  const rangeStart = startOfDay(rangeStartInput);
  const rangeEnd = startOfDay(rangeEndInput);

  const orders = candidateOrders.filter((order) => {
    const reportDate = reportDateOfOrder(order);
    return reportDate >= rangeStart && reportDate <= rangeEnd;
  });

  const summary = orders.reduce((acc, order) => {
    const split = splitAmount(order.totalPrice, organizationSharePercent);
    acc.mealCount += orderMealCount(order);
    acc.grossTotal += split.total;
    acc.organizationAmount += split.organizationAmount;
    acc.personalAmount += split.personalAmount;
    return acc;
  }, {
    mealCount: 0,
    grossTotal: 0,
    organizationAmount: 0,
    personalAmount: 0,
  });

  return { orders, summary };
}

async function buildUserStatement(user, query = {}, settings = {}) {
  await finalizeExpiredOrders();

  const organizationSharePercent = clampPercent(settings.organizationSharePercent);
  const personalSharePercent = 100 - organizationSharePercent;
  const { type, range, title } = await resolveReportRange(query);

  const { orders, summary } = await summarizeUserOrdersInRange(
    user,
    range.start,
    range.end,
    organizationSharePercent,
  );

  const items = orders.map((order) => {
    const grossTotal = Number(order.totalPrice || 0);
    const split = splitAmount(grossTotal, organizationSharePercent);
    const reportDate = reportDateOfOrder(order);
    return {
      orderId: order._id,
      orderNumber: order.orderNumber || null,
      date: reportDate,
      jalaliDate: formatJalaliDate(reportDate),
      foodName: orderFoodName(order),
      mealCount: orderMealCount(order),
      grossTotal: split.total,
      organizationAmount: split.organizationAmount,
      personalAmount: split.personalAmount,
      status: order.status,
    };
  });

  const periodKey = query.weekId
    ? `week:${query.weekId}`
    : (query.jalaliFrom && query.jalaliTo
      ? `month:${query.jalaliFrom}-${query.jalaliTo}`
      : `${type}:${formatJalaliDate(range.start)}-${formatJalaliDate(range.end)}`);

  return {
    statementNumber: buildStatementNumber(user, type === 'month' ? 'month' : 'week', periodKey),
    type,
    title,
    range: {
      start: range.start,
      end: range.end,
      jalaliStart: formatJalaliDate(range.start),
      jalaliEnd: formatJalaliDate(range.end),
    },
    split: {
      organizationSharePercent,
      personalSharePercent,
    },
    summary,
    items,
  };
}

async function listUserStatements(user, type = 'week', settings = {}) {
  await finalizeExpiredOrders();

  const organizationSharePercent = clampPercent(settings.organizationSharePercent);
  const personalSharePercent = 100 - organizationSharePercent;
  const periodType = type === 'month' ? 'month' : 'week';
  const statements = [];

  if (periodType === 'month') {
    const months = await getUserStatementMonths(user);
    for (const month of months) {
      const rangeStart = parseJalaliDate(month.from);
      const rangeEnd = parseJalaliDate(month.to);
      if (!rangeStart || !rangeEnd) continue;

      const { summary } = await summarizeUserOrdersInRange(
        user,
        rangeStart,
        rangeEnd,
        organizationSharePercent,
      );
      if (!summary.mealCount) continue;

      statements.push({
        statementNumber: buildStatementNumber(user, 'month', month.key),
        periodType: 'month',
        periodKey: month.key,
        title: month.label,
        range: {
          start: rangeStart,
          end: endOfRange(rangeEnd),
          jalaliStart: month.from,
          jalaliEnd: month.to,
        },
        split: { organizationSharePercent, personalSharePercent },
        summary,
      });
    }
    return statements;
  }

  const weeks = await getUserStatementWeeks(user);
  for (const week of weeks) {
    const { summary } = await summarizeUserOrdersInRange(
      user,
      week.startDate,
      week.endDate,
      organizationSharePercent,
    );
    if (!summary.mealCount) continue;

    statements.push({
      statementNumber: buildStatementNumber(user, 'week', String(week.weekId)),
      periodType: 'week',
      periodKey: String(week.weekId),
      title: week.label,
      range: {
        start: week.startDate,
        end: endOfRange(week.endDate),
        jalaliStart: week.jalaliStart,
        jalaliEnd: week.jalaliEnd,
      },
      split: { organizationSharePercent, personalSharePercent },
      summary,
      isActive: !!week.isActive,
    });
  }

  return statements;
}

async function getUserStatementWeeks(user) {
  const ownerFilter = await buildOrderOwnerFilter(user);
  const orders = await Order.find({
    ...ownerFilter,
    status: { $in: CONFIRMED_REPORT_STATUSES },
  })
    .select('menuItemId')
    .populate({
      path: 'menuItemId',
      select: 'dailyMenuId',
      populate: { path: 'dailyMenuId', select: 'weekId' },
    })
    .lean();

  const weekIds = new Set();
  for (const order of orders) {
    const weekId = order.menuItemId?.dailyMenuId?.weekId;
    if (weekId) weekIds.add(String(weekId));
  }
  if (!weekIds.size) return [];

  const weeks = await Week.find({ _id: { $in: [...weekIds] } })
    .sort({ startDate: -1 })
    .lean();

  return weeks.map((week) => ({
    weekId: week._id,
    label: week.name || `${formatJalaliDate(week.startDate)} تا ${formatJalaliDate(week.endDate)}`,
    jalaliStart: formatJalaliDate(week.startDate),
    jalaliEnd: formatJalaliDate(week.endDate),
    startDate: week.startDate,
    endDate: week.endDate,
    isActive: !!week.isActive,
  }));
}

async function getUserStatementMonths(user) {
  const ownerFilter = await buildOrderOwnerFilter(user);
  const orders = await Order.find({
    ...ownerFilter,
    status: { $in: CONFIRMED_REPORT_STATUSES },
  })
    .select('orderDate menuItemId status')
    .populate({
      path: 'menuItemId',
      select: 'dailyMenuId',
      populate: { path: 'dailyMenuId', select: 'date' },
    })
    .lean();

  const monthMap = new Map();
  for (const order of orders) {
    if (!isConfirmedReportOrder(order)) continue;
    const reportDate = order.menuItemId?.dailyMenuId?.date || order.orderDate;
    const { year, month } = getJalaliYearMonth(reportDate);
    if (!year || !month) continue;
    const item = jalaliMonthRangeValue(year, month);
    const current = monthMap.get(item.key) || { ...item, year, month, count: 0 };
    current.count += 1;
    monthMap.set(item.key, current);
  }

  return [...monthMap.values()]
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .map(({ key, label, from, to, count }) => ({ key, label, from, to, count }));
}

module.exports = {
  clampPercent,
  splitAmount,
  buildUserStatement,
  listUserStatements,
  getUserStatementWeeks,
  getUserStatementMonths,
};
