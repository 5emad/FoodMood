export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function jdate(value) {
  return new Date(value).toLocaleDateString('fa-IR-u-ca-persian');
}

export function money(value) {
  return `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
}

export function faDigits(n) {
  return Number(n || 0).toLocaleString('fa-IR');
}
