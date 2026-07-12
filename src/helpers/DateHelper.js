const MS_PER_DAY = 24 * 60 * 60 * 1000;
const digitMap = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function normalizeDigits(value) {
  return String(value).replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] || digit);
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getCurrentPersianParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);

  const pick = (type) => Number(normalizeDigits(parts.find((part) => part.type === type)?.value));
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function jalaliToGregorian(jy, jm, jd) {
  jy = Number(normalizeDigits(jy));
  jm = Number(normalizeDigits(jm));
  jd = Number(normalizeDigits(jd));

  let gy;
  if (jy > 979) {
    gy = 1600;
    jy -= 979;
  } else {
    gy = 621;
  }

  let days = (365 * jy)
    + Math.floor(jy / 33) * 8
    + Math.floor(((jy % 33) + 3) / 4)
    + 78
    + jd
    + (jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);

  gy += 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const salA = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 13 && gd > salA[gm]; gm += 1) {
    gd -= salA[gm];
  }

  return new Date(gy, gm - 1, gd);
}

function parseJalaliDate(value) {
  if (!value) return null;
  const normalized = normalizeDigits(value).trim().replace(/-/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  return startOfDay(jalaliToGregorian(match[1], match[2], match[3]));
}

function formatJalaliDate(date) {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

function formatJalaliMonth(date) {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'long',
  }).format(new Date(date));
}

function getPersianWeekStart(date = new Date()) {
  const d = startOfDay(date);
  const daysSinceSaturday = (d.getDay() + 1) % 7;
  return addDays(d, -daysSinceSaturday);
}

function getPersianWeekRange(date = new Date()) {
  const start = getPersianWeekStart(date);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getPersianWeekNumber(date = new Date()) {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil(((startOfDay(date) - yearStart) / MS_PER_DAY + 1) / 7));
}

function getPersianMonthRange(date = new Date()) {
  const current = startOfDay(date);
  const currentParts = getCurrentPersianParts(current);
  let start = current;

  while (true) {
    const previous = addDays(start, -1);
    const parts = getCurrentPersianParts(previous);
    if (parts.year !== currentParts.year || parts.month !== currentParts.month) break;
    start = previous;
  }

  let end = current;
  while (true) {
    const next = addDays(end, 1);
    const parts = getCurrentPersianParts(next);
    if (parts.year !== currentParts.year || parts.month !== currentParts.month) break;
    end = next;
  }
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getJalaliWeekTitle(start, end) {
  return `هفته ${formatJalaliDate(start)} تا ${formatJalaliDate(end)}`;
}

module.exports = {
  startOfDay,
  addDays,
  formatJalaliDate,
  formatJalaliMonth,
  parseJalaliDate,
  getPersianWeekRange,
  getPersianWeekStart,
  getPersianWeekNumber,
  getPersianMonthRange,
  getJalaliWeekTitle,
};
