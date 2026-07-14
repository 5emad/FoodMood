const Order = require('../models/Order');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
// Registered for the populate() calls below (departmentId, items.foodId).
require('../models/Department');
require('../models/Food');
const {
  startOfDay,
  addDays,
  formatJalaliDate,
  formatJalaliMonth,
  getPersianWeekRange,
  getPersianMonthRange,
  getJalaliWeekTitle,
  parseJalaliDate,
} = require('../helpers/DateHelper');
const { finalizeExpiredOrders } = require('../helpers/OrderStatusHelper');
const { orderUserDisplay } = require('../helpers/AuthUserHelper');

const persianMonthNames = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const CONFIRMED_REPORT_STATUSES = ['confirmed', 'ready', 'completed'];

function isConfirmedReportOrder(order) {
  return CONFIRMED_REPORT_STATUSES.includes(order.status);
}

function orderMealCount(order) {
  return order.quantity || order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 1;
}

function orderOwnerKey(order) {
  if (order.ldapUsername) return `ldap:${order.ldapUsername}`;
  return String(order.userId?._id || order.userId || '');
}

function isSuperadminReportUser(user) {
  return String(user?.role || '').toLowerCase() === 'superadmin'
    || String(user?.username || '').toLowerCase() === 'superadmin';
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

function orderFoodName(order) {
  return order.menuItemId?.foodId?.name
    || order.items?.map((item) => item.foodId?.name).filter(Boolean).join('، ')
    || '-';
}

/**
 * Resolves the report range/title from query params.
 * Shared by getReports and getReportPdf.
 * Default (no params): the ACTIVE week, falling back to the current Persian calendar week.
 */
async function resolveReportRange(query) {
  const { type = 'week', weekId, from, to, jalaliFrom, jalaliTo } = query;

  if (weekId) {
    const week = await Week.findById(weekId);
    if (!week) {
      const error = new Error('هفته یافت نشد');
      error.status = 404;
      throw error;
    }
    return {
      type: 'week',
      range: { start: week.startDate, end: endOfRange(week.endDate) },
      title: week.name || getJalaliWeekTitle(week.startDate, week.endDate),
    };
  }

  if ((from && to) || (jalaliFrom && jalaliTo)) {
    const start = jalaliFrom ? parseJalaliDate(jalaliFrom) : new Date(from);
    const end = jalaliTo ? parseJalaliDate(jalaliTo) : new Date(to);
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      const error = new Error('فرمت تاریخ شمسی نامعتبر است. نمونه درست: ۱۴۰۵/۰۳/۱۲');
      error.status = 400;
      throw error;
    }
    return {
      type: 'month',
      range: { start, end: endOfRange(end) },
      title: `${formatJalaliDate(start)} تا ${formatJalaliDate(end)}`,
    };
  }

  if (type === 'month') {
    const range = getPersianMonthRange(new Date());
    return {
      type: 'month',
      range: { start: range.start, end: endOfRange(range.end) },
      title: `گزارش ماه ${formatJalaliMonth(range.start)}`,
    };
  }

  // Default: active week (falls back to calendar week when no week is active)
  const activeWeek = await Week.findOne({ isActive: true }).lean();
  if (activeWeek) {
    return {
      type: 'week',
      range: { start: activeWeek.startDate, end: endOfRange(activeWeek.endDate) },
      title: activeWeek.name || getJalaliWeekTitle(activeWeek.startDate, activeWeek.endDate),
    };
  }

  const range = getPersianWeekRange(new Date());
  return {
    type: 'week',
    range: { start: range.start, end: endOfRange(range.end) },
    title: getJalaliWeekTitle(range.start, range.end),
  };
}

function endOfRange(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Loads only orders relevant to the range instead of the full collection.
 * An order belongs to the range if its menu delivery date OR orderDate falls inside.
 */
async function findOrdersInRange(rangeStart, rangeEnd) {
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

  return Order.find({ $or: orConditions })
    .sort({ orderDate: -1 })
    .populate({
      path: 'userId',
      select: 'username fullName departmentId role',
      populate: { path: 'departmentId', select: 'name' },
    })
    .populate('items.foodId', 'name')
    .populate({
      path: 'menuItemId',
      populate: [{ path: 'foodId', select: 'name' }, { path: 'dailyMenuId', select: 'date weekId' }],
    });
}

async function buildReport(rangeStartInput, rangeEndInput) {
  await finalizeExpiredOrders();

  const rangeStart = rangeStartInput ? startOfDay(rangeStartInput) : null;
  const rangeEnd = rangeEndInput ? startOfDay(rangeEndInput) : null;
  const reportDates = [];
  if (rangeStart && rangeEnd) {
    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      reportDates.push({ date: new Date(cursor), jalaliDate: formatJalaliDate(cursor) });
    }
  }

  const [candidateOrders, allUsers, ldapProfiles] = await Promise.all([
    findOrdersInRange(rangeStartInput, endOfRange(rangeEndInput)),
    User.find({
      status: { $ne: 'inactive' },
      role: { $nin: ['superadmin', 'guest'] },
      username: { $ne: 'superadmin' },
    }).populate('departmentId').sort({ fullName: 1 }).lean(),
    LdapProfile.find({}).lean(),
  ]);

  const reportDateOfOrder = (order) => startOfDay(order.menuItemId?.dailyMenuId?.date || order.orderDate);
  const ordersInRange = candidateOrders.filter((order) => {
    const actor = orderUserDisplay(order);
    if (isSuperadminReportUser(actor)) return false;
    const reportDate = reportDateOfOrder(order);
    return (!rangeStart || reportDate >= rangeStart) && (!rangeEnd || reportDate <= rangeEnd);
  });
  const orders = ordersInRange.filter(isConfirmedReportOrder);

  const totals = orders.reduce((acc, order) => {
    acc.totalOrders += 1;
    acc.totalMeals += orderMealCount(order);
    acc.totalPrice += Number(order.totalPrice || 0);
    acc.statuses[order.status] = (acc.statuses[order.status] || 0) + 1;
    return acc;
  }, { totalOrders: 0, totalMeals: 0, totalPrice: 0, statuses: {} });

  const byDayMap = new Map();
  const byFoodMap = new Map();
  const byDepartmentMap = new Map();

  for (const order of orders) {
    const reportDate = reportDateOfOrder(order);
    const dayKey = formatJalaliDate(reportDate);
    const dayRow = byDayMap.get(dayKey) || { date: reportDate, jalaliDate: dayKey, count: 0, totalPrice: 0 };
    dayRow.count += 1;
    dayRow.totalPrice += Number(order.totalPrice || 0);
    byDayMap.set(dayKey, dayRow);

    const actor = orderUserDisplay(order);
    const department = actor.department;
    const departmentRow = byDepartmentMap.get(department) || { department, count: 0, totalPrice: 0 };
    departmentRow.count += 1;
    departmentRow.totalPrice += Number(order.totalPrice || 0);
    byDepartmentMap.set(department, departmentRow);

    for (const item of order.items || []) {
      const foodId = String(item.foodId?._id || item.foodId || order.menuItemId?.foodId?._id || '');
      if (!foodId) continue;
      const foodName = item.foodId?.name || order.menuItemId?.foodId?.name || '-';
      const foodRow = byFoodMap.get(foodId) || { foodId, foodName, count: 0, totalPrice: 0 };
      foodRow.count += Number(item.quantity || 1);
      foodRow.totalPrice += Number(item.price || 0) * Number(item.quantity || 1);
      byFoodMap.set(foodId, foodRow);
    }
  }

  const orderedUserIds = new Set();
  const byUserMap = new Map(allUsers.map((user) => [String(user._id), {
    userId: user._id,
    fullName: user.fullName || user.username,
    username: user.username,
    role: user.role,
    department: user.departmentId?.name || 'بدون واحد',
    total: 0,
    totalPrice: 0,
    days: reportDates.map((date) => ({ ...date, foods: [] })),
  }]));

  for (const profile of ldapProfiles) {
    const ownerKey = `ldap:${profile.ldapUsername}`;
    if (byUserMap.has(ownerKey)) continue;
    byUserMap.set(ownerKey, {
      userId: ownerKey,
      fullName: profile.fullName || profile.ldapUsername,
      username: profile.ldapUsername,
      role: profile.role === 'admin' ? 'admin' : 'user',
      department: profile.department || 'بدون واحد',
      total: 0,
      totalPrice: 0,
      days: reportDates.map((date) => ({ ...date, foods: [] })),
    });
  }

  for (const order of orders) {
    let row;
    let ownerKey;
    if (order.ldapUsername) {
      ownerKey = `ldap:${order.ldapUsername}`;
      if (!byUserMap.has(ownerKey)) {
        byUserMap.set(ownerKey, {
          userId: ownerKey,
          fullName: order.orderUserName || order.ldapUsername,
          username: order.ldapUsername,
          role: 'user',
          department: order.orderUserDepartment || 'بدون واحد',
          total: 0,
          totalPrice: 0,
          days: reportDates.map((date) => ({ ...date, foods: [] })),
        });
      }
      row = byUserMap.get(ownerKey);
      if (row && order.orderUserName && row.fullName === order.ldapUsername) {
        row.fullName = order.orderUserName;
      }
    } else {
      ownerKey = String(order.userId?._id || order.userId);
      row = byUserMap.get(ownerKey);
    }

    if (row) {
      orderedUserIds.add(ownerKey);
      const jalaliDate = formatJalaliDate(reportDateOfOrder(order));
      const day = row.days.find((item) => item.jalaliDate === jalaliDate);
      if (day) day.foods.push(orderFoodName(order));
      row.total += orderMealCount(order);
      row.totalPrice += Number(order.totalPrice || 0);
    }
  }

  const byUser = [...byUserMap.values()].filter((item) => item.total > 0);
  const missingUsers = [...byUserMap.values()]
    .filter((item) => !orderedUserIds.has(String(item.userId)))
    .reduce((acc, item) => {
      if (!acc[item.department]) acc[item.department] = [];
      acc[item.department].push(item.fullName);
      return acc;
    }, {});

  return {
    totals,
    days: reportDates,
    byDay: [...byDayMap.values()].sort((a, b) => a.date - b.date),
    byFood: [...byFoodMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    byDepartment: [...byDepartmentMap.values()].sort((a, b) => b.count - a.count),
    byUser,
    missingUsers,
    orders,
  };
}

async function getAvailableReportMonths() {
  const orders = await Order.find({})
    .select('orderDate menuItemId userId')
    .populate('userId', 'role username')
    .populate({
      path: 'menuItemId',
      select: 'dailyMenuId',
      populate: { path: 'dailyMenuId', select: 'date' },
    })
    .lean();
  const monthMap = new Map();

  for (const order of orders) {
    const actor = order.ldapUsername
      ? { role: 'user', username: order.ldapUsername }
      : order.userId;
    if (isSuperadminReportUser(actor)) continue;
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
  resolveReportRange,
  buildReport,
  getAvailableReportMonths,
  isSuperadminReportUser,
  isConfirmedReportOrder,
  CONFIRMED_REPORT_STATUSES,
};
