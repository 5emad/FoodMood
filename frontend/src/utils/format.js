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

export function tomanSuffix() {
  if (typeof document !== 'undefined') {
    if (document.documentElement.dataset.appFont === 'yekanbakh') {
      return `\u00A0\u0621`;
    }
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--toman-suffix').trim();
    let cleaned = raw.replace(/^["']|["']$/g, '');
    // اگر escapeهای CSS به‌اشتباه به‌صورت متن برگشته باشند، تبدیل کن
    if (/\\u?[0-9a-fA-F]{2,4}/.test(cleaned) || /\\00a0|\\0621/i.test(cleaned)) {
      cleaned = cleaned
        .replace(/\\u([0-9a-fA-F]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\([0-9a-fA-F]{2,4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    if (cleaned && !/\\/.test(cleaned)) return cleaned;
  }
  return ' تومان';
}

/** برچسب واحد پول برای عناوین جدول/placeholder */
export function tomanLabel() {
  if (typeof document !== 'undefined' && document.documentElement.dataset.appFont === 'yekanbakh') {
    return '\u0621';
  }
  const suffix = tomanSuffix().trim();
  return suffix || 'تومان';
}

export function money(value) {
  return `${Number(value || 0).toLocaleString('fa-IR')}${tomanSuffix()}`;
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
