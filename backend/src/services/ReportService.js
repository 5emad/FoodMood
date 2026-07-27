const Order = require('../models/Order');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const FoodCategory = require('../models/FoodCategory');
const { ensureDefaultCategories } = require('../controllers/FoodCategoryController');
// Registered for the populate() calls below (departmentId, items.foodId).
require('../models/Department');
require('../models/Food');
require('../models/Guest');
require('../models/MenuItem');
const {
  startOfDay,
  addDays,
  formatJalaliDate,
  formatJalaliMonth,
  getPersianWeekRange,
  getPersianMonthRange,
  daysInJalaliMonth,
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

function guestTypeLabel(type) {
  return type === 'permanent' ? 'دائم' : 'موقت';
}

function isGuestOrder(order) {
  return Boolean(order.guestId);
}

const { isSuperadminReportUser } = require('../helpers/PermissionHelper');

function normalizeReportDigits(value) {
  const map = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  return String(value).replace(/[۰-۹٠-٩]/g, (digit) => map[digit] || digit);
}

function getJalaliYearMonth(date) {
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(date));
  const pick = (type) => Number(normalizeReportDigits(parts.find((part) => part.type === type)?.value || '0'));
  return { year: pick('year'), month: pick('month') };
}

function jalaliMonthRangeValue(year, month) {
  const monthText = String(month).padStart(2, '0');
  const lastDay = daysInJalaliMonth(year, month);
  return {
    key: `${year}-${monthText}`,
    label: `${persianMonthNames[month - 1]} ${year}`,
    from: `${year}/${monthText}/01`,
    to: `${year}/${monthText}/${String(lastDay).padStart(2, '0')}`,
  };
}

function orderFoodName(order) {
  return order.menuItemId?.foodId?.name
    || order.items?.map((item) => item.foodId?.name).filter(Boolean).join('، ')
    || '-';
}

/** برای گزارش: نام و دسته غذا */
function foodEntryFromDoc(food) {
  if (!food?.name) return null;
  return {
    name: food.name,
    category: String(food.category || '').trim() || 'uncategorized',
  };
}

function orderFoodEntries(order) {
  const menuFood = order.menuItemId?.foodId;
  const fromMenu = foodEntryFromDoc(menuFood);
  if (fromMenu) return [fromMenu];
  const fromItems = (order.items || [])
    .map((item) => foodEntryFromDoc(item.foodId))
    .filter(Boolean);
  if (fromItems.length) return fromItems;
  const fallbackName = orderFoodName(order);
  if (fallbackName && fallbackName !== '-') {
    return [{
      name: fallbackName,
      category: String(order.foodCategory || '').trim() || 'uncategorized',
    }];
  }
  return [];
}

function pushFoodEntries(day, order) {
  if (!day) return;
  for (const entry of orderFoodEntries(order)) {
    day.foods.push(entry);
  }
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
 * Loads only confirmed orders relevant to the range (lean + field-limited).
 * Prefer dailyMenuId (indexed) over scanning all orderDates.
 */
async function findOrdersInRange(rangeStart, rangeEnd) {
  const dailyMenus = await DailyMenu.find({
    date: { $gte: rangeStart, $lte: rangeEnd },
  }).select('_id').lean();
  const dailyMenuIds = dailyMenus.map((m) => m._id);

  const statusFilter = { status: { $in: CONFIRMED_REPORT_STATUSES } };
  let query;
  if (dailyMenuIds.length) {
    query = {
      ...statusFilter,
      $or: [
        { dailyMenuId: { $in: dailyMenuIds } },
        // legacy rows without dailyMenuId
        { dailyMenuId: null, orderDate: { $gte: rangeStart, $lte: rangeEnd } },
        { dailyMenuId: { $exists: false }, orderDate: { $gte: rangeStart, $lte: rangeEnd } },
      ],
    };
  } else {
    query = {
      ...statusFilter,
      orderDate: { $gte: rangeStart, $lte: rangeEnd },
    };
  }

  return Order.find(query)
    .select([
      'status', 'quantity', 'totalPrice', 'orderDate', 'items',
      'userId', 'ldapUsername', 'guestId', 'menuItemId', 'dailyMenuId',
      'orderUserName', 'orderUserDepartment', 'foodCategory',
    ].join(' '))
    .sort({ orderDate: -1 })
    .populate({
      path: 'userId',
      select: 'username fullName departmentId role',
      populate: { path: 'departmentId', select: 'name' },
    })
    .populate('items.foodId', 'name category')
    .populate({
      path: 'guestId',
      select: 'guestCode fullName guestType department status validUntil',
    })
    .populate({
      path: 'menuItemId',
      select: 'foodId dailyMenuId',
      populate: [
        { path: 'foodId', select: 'name category' },
        { path: 'dailyMenuId', select: 'date weekId' },
      ],
    })
    .populate({ path: 'dailyMenuId', select: 'date weekId' })
    .lean();
}

/** Short TTL cache for month list (invalidates on process restart / TTL). */
let monthsCache = { at: 0, data: null };
const MONTHS_CACHE_MS = 90 * 1000;

/**
 * @param {Date} rangeStartInput
 * @param {Date} rangeEndInput
 * @param {{ mode?: 'full'|'prep' }} [options]
 *   prep = supplier-only (skip users/LDAP/personnel rows)
 */
async function buildReport(rangeStartInput, rangeEndInput, options = {}) {
  const mode = options.mode === 'prep' ? 'prep' : 'full';

  // Do not block report on finalize — interval job already handles this
  finalizeExpiredOrders().catch(() => {});

  const rangeStart = rangeStartInput ? startOfDay(rangeStartInput) : null;
  const rangeEnd = rangeEndInput ? startOfDay(rangeEndInput) : null;
  const reportDates = [];
  if (rangeStart && rangeEnd) {
    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
      reportDates.push({ date: new Date(cursor), jalaliDate: formatJalaliDate(cursor) });
    }
  }

  const candidateOrders = await findOrdersInRange(rangeStartInput, endOfRange(rangeEndInput));

  const reportDateOfOrder = (order) => startOfDay(
    order.dailyMenuId?.date || order.menuItemId?.dailyMenuId?.date || order.orderDate,
  );
  const orders = candidateOrders.filter((order) => {
    const reportDate = reportDateOfOrder(order);
    return (!rangeStart || reportDate >= rangeStart) && (!rangeEnd || reportDate <= rangeEnd);
  });

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
  const byDayPrepMap = new Map();

  for (const order of orders) {
    const reportDate = reportDateOfOrder(order);
    const dayKey = formatJalaliDate(reportDate);
    const mealCount = orderMealCount(order);
    const foodEntries = orderFoodEntries(order);
    const primaryEntry = foodEntries[0] || { name: orderFoodName(order), category: 'uncategorized' };

    const dayRow = byDayMap.get(dayKey) || { date: reportDate, jalaliDate: dayKey, count: 0, totalPrice: 0 };
    dayRow.count += 1;
    dayRow.totalPrice += Number(order.totalPrice || 0);
    byDayMap.set(dayKey, dayRow);

    const prepRow = byDayPrepMap.get(dayKey) || {
      date: reportDate,
      jalaliDate: dayKey,
      foodCounts: new Map(),
      totalMeals: 0,
      userMeals: 0,
      guestMeals: 0,
    };
    prepRow.totalMeals += mealCount;
    if (isGuestOrder(order)) prepRow.guestMeals += mealCount;
    else prepRow.userMeals += mealCount;
    const perEntryMeals = foodEntries.length <= 1
      ? mealCount
      : 1;
    for (const entry of foodEntries) {
      const prepKey = `${entry.category}|${entry.name}`;
      const prev = prepRow.foodCounts.get(prepKey) || { foodName: entry.name, category: entry.category, count: 0 };
      prev.count += perEntryMeals;
      prepRow.foodCounts.set(prepKey, prev);
    }
    byDayPrepMap.set(dayKey, prepRow);

    const actor = orderUserDisplay(order);
    const department = actor.department;
    const departmentRow = byDepartmentMap.get(department) || { department, count: 0, totalPrice: 0 };
    departmentRow.count += 1;
    departmentRow.totalPrice += Number(order.totalPrice || 0);
    byDepartmentMap.set(department, departmentRow);

    const items = order.items || [];
    if (items.length) {
      for (const item of items) {
        const foodId = String(item.foodId?._id || item.foodId || order.menuItemId?.foodId?._id || '');
        if (!foodId) continue;
        const itemName = item.foodId?.name || order.menuItemId?.foodId?.name || '-';
        const itemCategory = String(item.foodId?.category || order.menuItemId?.foodId?.category || primaryEntry.category || 'uncategorized');
        const foodRow = byFoodMap.get(foodId) || { foodId, foodName: itemName, category: itemCategory, count: 0, totalPrice: 0 };
        foodRow.count += Number(item.quantity || 1);
        foodRow.totalPrice += Number(item.price || 0) * Number(item.quantity || 1);
        byFoodMap.set(foodId, foodRow);
      }
    } else {
      // Legacy orders: items[] empty but menuItemId.foodId present
      const foodId = String(order.menuItemId?.foodId?._id || order.menuItemId?.foodId || '');
      if (foodId) {
        const itemName = order.menuItemId?.foodId?.name || primaryEntry.name || '-';
        const itemCategory = String(order.menuItemId?.foodId?.category || primaryEntry.category || 'uncategorized');
        const foodRow = byFoodMap.get(foodId) || { foodId, foodName: itemName, category: itemCategory, count: 0, totalPrice: 0 };
        foodRow.count += mealCount;
        foodRow.totalPrice += Number(order.totalPrice || 0);
        byFoodMap.set(foodId, foodRow);
      }
    }
  }

  const byDayPrep = reportDates.map((dateInfo) => {
    const prep = byDayPrepMap.get(dateInfo.jalaliDate);
    if (!prep) {
      return {
        date: dateInfo.date,
        jalaliDate: dateInfo.jalaliDate,
        foods: [],
        totalMeals: 0,
        userMeals: 0,
        guestMeals: 0,
      };
    }
    return {
      date: prep.date,
      jalaliDate: prep.jalaliDate,
      totalMeals: prep.totalMeals,
      userMeals: prep.userMeals,
      guestMeals: prep.guestMeals,
      foods: [...prep.foodCounts.values()]
        .map((row) => ({ foodName: row.foodName, category: row.category, count: row.count }))
        .sort((a, b) => b.count - a.count || String(a.foodName).localeCompare(String(b.foodName), 'fa')),
    };
  });

  const prepTotals = byDayPrep.reduce((acc, day) => {
    acc.totalMeals += day.totalMeals;
    acc.userMeals += day.userMeals;
    acc.guestMeals += day.guestMeals;
    return acc;
  }, { totalMeals: 0, userMeals: 0, guestMeals: 0 });

  const categoriesPromise = FoodCategory.find({ status: 'active' })
    .select('key name sortOrder')
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  // Supplier path: skip personnel / LDAP scaffolding
  if (mode === 'prep') {
    let categories = await categoriesPromise;
    if (!categories.length) {
      await ensureDefaultCategories();
      categories = await FoodCategory.find({ status: 'active' })
        .select('key name sortOrder').sort({ sortOrder: 1, name: 1 }).lean();
    }
    return {
      totals,
      prepTotals,
      days: reportDates,
      categories: categories.map((c) => ({
        key: c.key,
        name: c.name,
        sortOrder: Number(c.sortOrder || 0),
      })),
      byDay: [...byDayMap.values()].sort((a, b) => a.date - b.date),
      byDayPrep,
      byFood: [...byFoodMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      byDepartment: [...byDepartmentMap.values()].sort((a, b) => b.count - a.count),
      byUser: [],
      byGuest: [],
      missingUsers: {},
      orders: [],
    };
  }

  const emptyDays = () => reportDates.map((date) => ({ ...date, foods: [] }));
  const orderedUserIds = new Set();
  const byUserMap = new Map();

  for (const order of orders) {
    if (isGuestOrder(order)) continue;

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
          days: emptyDays(),
        });
      }
      row = byUserMap.get(ownerKey);
      if (row && order.orderUserName && row.fullName === order.ldapUsername) {
        row.fullName = order.orderUserName;
      }
    } else {
      ownerKey = String(order.userId?._id || order.userId || '');
      if (!ownerKey || ownerKey === 'undefined' || ownerKey === 'null') continue;
      if (!byUserMap.has(ownerKey)) {
        const user = order.userId || {};
        byUserMap.set(ownerKey, {
          userId: user._id || ownerKey,
          fullName: user.fullName || user.username || order.orderUserName || 'کاربر',
          username: user.username || '',
          role: user.role || 'user',
          department: user.departmentId?.name || order.orderUserDepartment || 'بدون واحد',
          total: 0,
          totalPrice: 0,
          days: emptyDays(),
        });
      }
      row = byUserMap.get(ownerKey);
    }

    if (row) {
      orderedUserIds.add(ownerKey);
      const jalaliDate = formatJalaliDate(reportDateOfOrder(order));
      const day = row.days.find((item) => (
        normalizeReportDigits(item.jalaliDate) === normalizeReportDigits(jalaliDate)
      ));
      if (day) pushFoodEntries(day, order);
      row.total += orderMealCount(order);
      row.totalPrice += Number(order.totalPrice || 0);
    }
  }

  const byGuestMap = new Map();
  for (const order of orders) {
    if (!isGuestOrder(order)) continue;
    const guest = order.guestId;
    const guestKey = String(guest?._id || guest || order.guestId || '');
    if (!guestKey || guestKey === 'undefined' || guestKey === 'null') continue;
    if (!byGuestMap.has(guestKey)) {
      byGuestMap.set(guestKey, {
        guestId: guest?._id || guest,
        guestCode: guest?.guestCode || '-',
        fullName: guest?.fullName || order.orderUserName || 'مهمان',
        guestType: guest?.guestType || 'temporary',
        guestTypeLabel: guestTypeLabel(guest?.guestType),
        department: guest?.department || order.orderUserDepartment || 'مهمان',
        total: 0,
        totalPrice: 0,
        days: emptyDays(),
      });
    }
    const row = byGuestMap.get(guestKey);
    const jalaliDate = formatJalaliDate(reportDateOfOrder(order));
    const day = row.days.find((item) => (
      normalizeReportDigits(item.jalaliDate) === normalizeReportDigits(jalaliDate)
    ));
    if (day) pushFoodEntries(day, order);
    row.total += orderMealCount(order);
    row.totalPrice += Number(order.totalPrice || 0);
  }

  // missingUsers: light query — no pre-scaffold of every profile with day grids
  const [allUsers, ldapProfiles, categoriesRaw] = await Promise.all([
    User.find({
      status: { $ne: 'inactive' },
      role: { $nin: ['superadmin', 'guest'] },
      username: { $ne: 'superadmin' },
    }).select('fullName username role departmentId').populate('departmentId', 'name').lean(),
    LdapProfile.find({}).select('ldapUsername fullName role department').lean(),
    categoriesPromise,
  ]);

  let categories = categoriesRaw;
  if (!categories.length) {
    await ensureDefaultCategories();
    categories = await FoodCategory.find({ status: 'active' })
      .select('key name sortOrder').sort({ sortOrder: 1, name: 1 }).lean();
  }

  // Enrich LDAP row names from profiles when order only had username
  for (const profile of ldapProfiles) {
    const ownerKey = `ldap:${profile.ldapUsername}`;
    const row = byUserMap.get(ownerKey);
    if (!row) continue;
    if (profile.fullName) row.fullName = profile.fullName;
    if (profile.department) row.department = profile.department;
    if (profile.role === 'admin') row.role = 'admin';
  }

  const missingUsers = {};
  for (const user of allUsers) {
    const key = String(user._id);
    if (orderedUserIds.has(key)) continue;
    if (isSuperadminReportUser(user)) continue;
    const dept = user.departmentId?.name || 'بدون واحد';
    if (!missingUsers[dept]) missingUsers[dept] = [];
    missingUsers[dept].push(user.fullName || user.username);
  }
  for (const profile of ldapProfiles) {
    const key = `ldap:${profile.ldapUsername}`;
    if (orderedUserIds.has(key)) continue;
    if (isSuperadminReportUser({ username: profile.ldapUsername, role: profile.role })) continue;
    const dept = profile.department || 'بدون واحد';
    if (!missingUsers[dept]) missingUsers[dept] = [];
    missingUsers[dept].push(profile.fullName || profile.ldapUsername);
  }

  const byUser = [...byUserMap.values()].filter((item) => item.total > 0);
  const byGuest = [...byGuestMap.values()].filter((item) => item.total > 0)
    .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'fa'));

  return {
    totals,
    prepTotals,
    days: reportDates,
    categories: categories.map((c) => ({
      key: c.key,
      name: c.name,
      sortOrder: Number(c.sortOrder || 0),
    })),
    byDay: [...byDayMap.values()].sort((a, b) => a.date - b.date),
    byDayPrep,
    byFood: [...byFoodMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    byDepartment: [...byDepartmentMap.values()].sort((a, b) => b.count - a.count),
    byUser,
    byGuest,
    missingUsers,
    orders: [], // never ship raw orders to the client — huge unused payload
  };
}

async function getAvailableReportMonths() {
  if (monthsCache.data && (Date.now() - monthsCache.at) < MONTHS_CACHE_MS) {
    return monthsCache.data;
  }

  const orders = await Order.find({ status: { $in: CONFIRMED_REPORT_STATUSES } })
    .select('orderDate dailyMenuId')
    .lean();

  const menuIds = [...new Set(
    orders.map((o) => (o.dailyMenuId ? String(o.dailyMenuId) : '')).filter(Boolean),
  )];
  const menus = menuIds.length
    ? await DailyMenu.find({ _id: { $in: menuIds } }).select('date').lean()
    : [];
  const menuDate = new Map(menus.map((m) => [String(m._id), m.date]));

  const monthMap = new Map();
  for (const order of orders) {
    const reportDate = (order.dailyMenuId && menuDate.get(String(order.dailyMenuId))) || order.orderDate;
    if (!reportDate) continue;
    const { year, month } = getJalaliYearMonth(reportDate);
    if (!year || !month) continue;
    const item = jalaliMonthRangeValue(year, month);
    const current = monthMap.get(item.key) || { ...item, year, month, count: 0 };
    current.count += 1;
    monthMap.set(item.key, current);
  }

  const data = [...monthMap.values()]
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .map(({ key, label, from, to, count }) => ({ key, label, from, to, count }));

  monthsCache = { at: Date.now(), data };
  return data;
}

module.exports = {
  resolveReportRange,
  buildReport,
  getAvailableReportMonths,
  isSuperadminReportUser,
  isConfirmedReportOrder,
  CONFIRMED_REPORT_STATUSES,
};
