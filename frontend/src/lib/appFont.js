/** اعمال فونت سامانه از تنظیمات (vazirmatn | yekanbakh) */
export function applyAppFont(uiFont) {
  const font = uiFont === 'yekanbakh' ? 'yekanbakh' : 'vazirmatn';
  if (typeof document === 'undefined') return font;
  document.documentElement.dataset.appFont = font;
  document.documentElement.classList.toggle('font-yekanbakh', font === 'yekanbakh');
  document.documentElement.classList.toggle('font-vazirmatn', font === 'vazirmatn');
  return font;
}

export function refreshThemeVars() {
  const link = document.querySelector('link[href*="theme-vars.css"]');
  if (link) {
    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('v', String(Date.now()));
    link.href = url.pathname + url.search;
  }
}
