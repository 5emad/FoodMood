const Week = require('../models/Week');
const Day = require('../models/Day');
const DailyMenu = require('../models/DailyMenu');
const {
  startOfDay,
  addDays,
  getPersianWeekRange,
  getPersianWeekNumber,
  getJalaliWeekTitle,
} = require('../helpers/DateHelper');

const dayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

/**
 * Finds a week whose startDate is within +/-12h of the given instant.
 * Exact-timestamp matching created duplicate weeks whenever the server
 * timezone/DST offset changed, so we match at day granularity instead.
 */
function findWeekNear(start) {
  const HALF_DAY = 12 * 60 * 60 * 1000;
  return Week.findOne({
    startDate: {
      $gte: new Date(start.getTime() - HALF_DAY),
      $lte: new Date(start.getTime() + HALF_DAY),
    },
  });
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
  const base = startOfDay(week.startDate);

  await Promise.all(days.map((day, offset) => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return DailyMenu.findOneAndUpdate(
      { weekId: week._id, dayId: day._id },
      { $setOnInsert: { weekId: week._id, dayId: day._id, date } },
      { upsert: true, new: true }
    );
  }));
}

async function ensureCurrentWeek() {
  const { start, end } = getPersianWeekRange(new Date());
  const weekNumber = getPersianWeekNumber(start);

  let week = await findWeekNear(start);
  if (!week) {
    week = await Week.create({
      name: getJalaliWeekTitle(start, end),
      weekNumber,
      startDate: start,
      endDate: end,
      isActive: true,
      status: 'active',
    });
  }

  await Week.updateMany({ _id: { $ne: week._id } }, { $set: { isActive: false, status: 'inactive' } });
  week.name = week.name || getJalaliWeekTitle(start, end);
  week.weekNumber = week.weekNumber || weekNumber;
  week.startDate = start;
  week.endDate = end;
  week.isActive = true;
  week.status = 'active';
  await week.save();
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

    let week = await findWeekNear(start);
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
      week.name = week.name || getJalaliWeekTitle(start, end);
      week.weekNumber = week.weekNumber || weekNumber;
      week.endDate = week.endDate || end;
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
  getActiveWeek,
};
