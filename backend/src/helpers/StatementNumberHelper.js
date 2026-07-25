const crypto = require('crypto');

const digitMap = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function normalizeDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] || digit);
}

function ownerKeyOfUser(user = {}) {
  if (user.guestCode || user.guestId) {
    return `guest:${user.guestCode || user.guestId}`;
  }
  if (user.ldapUsername) return `ldap:${user.ldapUsername}`;
  if (user.username) return `user:${user.username}`;
  return `id:${user.id || user._id || 'unknown'}`;
}

/**
 * کلید استاندارد دوره برای شناسه صورتحساب:
 * - هفته: فقط weekId (بدون پیشوند)
 * - ماه: YYYY-MM شمسی (مثل 1405-05)
 *
 * هر ورودی دیگری (week:…، month:…، از-تا) به همین قالب نرمال می‌شود
 * تا لیست، پاپ‌آپ و پنل ادمین یک شناسه یکسان ببینند.
 */
function normalizePeriodKey(periodType, periodKey, extras = {}) {
  const type = periodType === 'month' ? 'month' : 'week';
  let key = normalizeDigits(periodKey || '').trim();

  if (type === 'week') {
    return key.replace(/^week:/i, '').trim();
  }

  if (/^\d{4}-\d{2}$/.test(key)) return key;

  key = key.replace(/^month:/i, '').trim();

  const fromHint = normalizeDigits(extras.jalaliFrom || '').trim();
  const candidates = [fromHint, key.split(/[-–—]/)[0], key];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/(\d{4})\D+(\d{1,2})/);
    if (match) {
      return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
    }
  }
  return key;
}

/**
 * شناسه پایدار و یکتا برای هر کاربر/مهمان + دوره
 */
function buildStatementNumber(user, periodType, periodKey, extras = {}) {
  const type = periodType === 'month' ? 'month' : 'week';
  const normalizedKey = normalizePeriodKey(type, periodKey, extras);
  const ownerKey = ownerKeyOfUser(user);
  const seed = `${ownerKey}|${type}|${normalizedKey}`;
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const numeric = (parseInt(digest.slice(0, 8), 16) % 900000) + 100000;
  const isGuest = ownerKey.startsWith('guest:');
  const prefix = isGuest
    ? (type === 'week' ? 'GSW' : 'GSM')
    : (type === 'week' ? 'FSW' : 'FSM');
  return `${prefix}-${numeric}`;
}

module.exports = {
  buildStatementNumber,
  normalizePeriodKey,
  ownerKeyOfUser,
};
