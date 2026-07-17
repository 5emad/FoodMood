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
  const base = startOfDay(getPersianWeekStart(week.startDate));
  const dates = days.map((_, offset) => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return date;
  });

  // ایجاد رکوردها در صورت نبود
  for (let i = 0; i < days.length; i += 1) {
    await DailyMenu.findOneAndUpdate(
      { weekId: week._id, dayId: days[i]._id },
      { $setOnInsert: { weekId: week._id, dayId: days[i]._id, date: dates[i] } },
      { upsert: true },
    );
  }

  // دو مرحله‌ای تا با unique(weekId, date) تداخل نداشته باشد
  for (let i = 0; i < days.length; i += 1) {
    const temp = new Date(base);
    temp.setFullYear(temp.getFullYear() + 50);
    temp.setDate(temp.getDate() + i);
    await DailyMenu.updateOne(
      { weekId: week._id, dayId: days[i]._id },
      { $set: { date: temp, updatedAt: new Date() } },
    );
  }
  for (let i = 0; i < days.length; i += 1) {
    await DailyMenu.updateOne(
      { weekId: week._id, dayId: days[i]._id },
      { $set: { date: dates[i], updatedAt: new Date() } },
    );
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
