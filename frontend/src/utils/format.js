const TEHRAN_TZ = 'Asia/Tehran';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** تاریخ شمسی به وقت تهران — هم‌راستا با بک‌اند */
export function jdate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function jdateParts(value) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(value));
  const pick = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

export function money(value) {
  return `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
}

export function compactMoney(value) {
  return Number(value || 0).toLocaleString('fa-IR');
}

/** ارقام فارسی؛ برای سال/شماره صفحه grouping را خاموش کنید تا ۱٬۴۰۵ نشود */
export function faDigits(n, { useGrouping = true } = {}) {
  return Number(n || 0).toLocaleString('fa-IR', { useGrouping });
}

export function faYear(n) {
  return faDigits(n, { useGrouping: false });
}

export { TEHRAN_TZ };
