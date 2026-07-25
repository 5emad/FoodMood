const Week = require('../models/Week');
const Day = require('../models/Day');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const {
  startOfDay,
  addDays,
  formatJalaliDate,
  getPersianWeekRange,
  getPersianWeekStart,
  getPersianWeekNumber,
  getJalaliWeekTitle,
} = require('../helpers/DateHelper');

const dayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

function getWeekRangeKey(date) {
  const start = startOfDay(getPersianWeekStart(date));
  const end = addDays(start, 6);
  return `${formatJalaliDate(start)}|${formatJalaliDate(end)}`;
}

/**
 * Finds a week for the same Persian calendar week as the given start instant.
 */
async function findWeekByStart(start) {
  const targetStart = startOfDay(getPersianWeekStart(start));
  const candidates = await Week.find({
    startDate: {
      $gte: addDays(targetStart, -2),
      $lte: addDays(targetStart, 9),
    },
  });
  return candidates.find(
    (week) => startOfDay(getPersianWeekStart(week.startDate)).getTime() === targetStart.getTime(),
  ) || null;
}

async function ensureDays() {
  const ops = dayNames.map((name, index) => ({
    updateOne: {
      filter: { index: index + 1 },
      update: { $setOnInsert: { index: index + 1, name } },
      upsert: true,
    },
  }));
  await Day.bulkWrite(ops);
  return Day.find().sort({ index: 1 });
}

async function ensureDailyMenus(week) {
  const days = await ensureDays();
  const dayByIndex = new Map(days.map((d) => [d.index, d]));
  const start = startOfDay(week.startDate);
  const end = startOfDay(week.endDate);
  if (end < start) return;

  const persianDayIndex = (date) => ((startOfDay(date).getDay() + 1) % 7) + 1;

  /** جفت‌های dayId+date در بازهٔ هفته */
  const planned = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = startOfDay(new Date(cursor));
    const day = dayByIndex.get(persianDayIndex(date));
    if (!day) continue;
    planned.push({ day, date });
  }

  // اگر در یک بازه بیش از یک روز با همان weekday بیاید (بازه > ۷)، آخرین تاریخ همان روز می‌ماند
  const byDayId = new Map();
  for (const row of planned) {
    byDayId.set(String(row.day._id), row);
  }
  const uniquePlanned = [...byDayId.values()];

  // ۱) اطمینان از وجود رکورد برای هر روز هفته (بر اساس dayId یکتا)
  for (const { day, date } of uniquePlanned) {
    await DailyMenu.findOneAndUpdate(
      { weekId: week._id, dayId: day._id },
      { $setOnInsert: { weekId: week._id, dayId: day._id, date } },
      { upsert: true },
    );
  }

  // ۲) دو مرحله‌ای برای جلوگیری از تداخل unique(weekId, date)
  for (let i = 0; i < uniquePlanned.length; i += 1) {
    const temp = new Date(start);
    temp.setFullYear(temp.getFullYear() + 50);
    temp.setDate(temp.getDate() + i);
    await DailyMenu.updateOne(
      { weekId: week._id, dayId: uniquePlanned[i].day._id },
      { $set: { date: temp, updatedAt: new Date() } },
    );
  }
  for (const { day, date } of uniquePlanned) {
    await DailyMenu.updateOne(
      { weekId: week._id, dayId: day._id },
      { $set: { date, updatedAt: new Date() } },
    );
  }

  // ۳) حذف منوهای روزهایی که دیگر در بازه نیستند (+ لغو سفارش‌های وابسته)
  const keepDayIds = uniquePlanned.map((p) => p.day._id);
  const obsolete = await DailyMenu.find({
    weekId: week._id,
    dayId: { $nin: keepDayIds },
  });
  if (obsolete.length) {
    const { cancelOrdersForMenuItems } = require('../helpers/OrderStatusHelper');
    const dailyMenuIds = obsolete.map((m) => m._id);
    const menuItems = await MenuItem.find({ dailyMenuId: { $in: dailyMenuIds } }).select('_id');
    const menuItemIds = menuItems.map((item) => item._id);
    if (menuItemIds.length) {
      await cancelOrdersForMenuItems(menuItemIds);
      await MenuItem.deleteMany({ _id: { $in: menuItemIds } });
    }
    await DailyMenu.deleteMany({ _id: { $in: dailyMenuIds } });
  }
}

async function mergeWeekRecords(keeper, duplicateId) {
  const dupMenus = await DailyMenu.find({ weekId: duplicateId });
  for (const dupMenu of dupMenus) {
    let keeperMenu = await DailyMenu.findOne({ weekId: keeper._id, dayId: dupMenu.dayId });
    if (!keeperMenu) {
      dupMenu.weekId = keeper._id;
      await dupMenu.save();
      continue;
    }

    const dupItems = await MenuItem.find({ dailyMenuId: dupMenu._id });
    for (const item of dupItems) {
      const existing = await MenuItem.findOne({ dailyMenuId: keeperMenu._id, foodId: item.foodId });
      if (existing) {
        await Order.updateMany(
          { menuItemId: item._id },
          { $set: { menuItemId: existing._id, weekId: keeper._id } },
        );
        await MenuItem.deleteOne({ _id: item._id });
      } else {
        item.dailyMenuId = keeperMenu._id;
        await item.save();
        await Order.updateMany({ menuItemId: item._id }, { $set: { weekId: keeper._id } });
      }
    }
    await DailyMenu.deleteOne({ _id: dupMenu._id });
  }

  await Order.updateMany({ weekId: duplicateId }, { $set: { weekId: keeper._id } });
  await Week.findByIdAndDelete(duplicateId);
}

async function dedupeWeeks() {
  const weeks = await Week.find().sort({ createdAt: 1 });
  const groups = new Map();

  for (const week of weeks) {
    const key = getWeekRangeKey(week.startDate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(week);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const sorted = [...group].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    const keeper = sorted[0];
    const { start, end } = getPersianWeekRange(keeper.startDate);

    keeper.name = getJalaliWeekTitle(start, end);
    keeper.weekNumber = keeper.weekNumber || getPersianWeekNumber(start);
    keeper.startDate = start;
    keeper.endDate = end;
    await keeper.save();
    await ensureDailyMenus(keeper);

    for (let i = 1; i < sorted.length; i += 1) {
      await mergeWeekRecords(keeper, sorted[i]._id);
    }
  }
}

async function ensureCurrentWeek() {
  await dedupeWeeks();

  const { start, end } = getPersianWeekRange(new Date());
  const weekNumber = getPersianWeekNumber(start);
  const hasActiveWeek = await Week.exists({ isActive: true });

  let week = await findWeekByStart(start);
  if (!week) {
    week = await Week.create({
      name: getJalaliWeekTitle(start, end),
      weekNumber,
      startDate: start,
      endDate: end,
      isActive: !hasActiveWeek,
      status: hasActiveWeek ? 'inactive' : 'active',
    });
  } else {
    week.name = getJalaliWeekTitle(start, end);
    week.weekNumber = week.weekNumber || weekNumber;
    week.startDate = start;
    week.endDate = end;
    if (!hasActiveWeek) {
      week.isActive = true;
      week.status = 'active';
    }
    await week.save();
  }

  await ensureDailyMenus(week);
  return week;
}

async function ensureFutureWeeks(count = 5) {
  const current = await ensureCurrentWeek();
  const weeks = [current];

  for (let i = 1; i <= count; i += 1) {
    const start = addDays(current.startDate, i * 7);
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    const weekNumber = getPersianWeekNumber(start);

    let week = await findWeekByStart(start);
    if (!week) {
      week = await Week.create({
        name: getJalaliWeekTitle(start, end),
        weekNumber,
        startDate: start,
        endDate: end,
        isActive: false,
        status: 'inactive',
      });
    } else {
      week.name = getJalaliWeekTitle(start, end);
      week.weekNumber = week.weekNumber || weekNumber;
      week.startDate = start;
      week.endDate = end;
      await week.save();
    }

    await ensureDailyMenus(week);
    weeks.push(week);
  }

  return weeks;
}

async function getActiveWeek() {
  return Week.findOne({ isActive: true });
}

module.exports = {
  ensureDays,
  ensureDailyMenus,
  ensureCurrentWeek,
  ensureFutureWeeks,
  dedupeWeeks,
  getActiveWeek,
};
