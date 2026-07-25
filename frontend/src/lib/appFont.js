/** اعمال فونت سامانه از تنظیمات (vazirmatn | yekanbakh) */
const FONT_STACK = {
  yekanbakh: "'Yekan Bakh FaNum', Tahoma, sans-serif",
  vazirmatn: "'Vazirmatn', Tahoma, sans-serif",
};

export function applyAppFont(uiFont) {
  const font = uiFont === 'yekanbakh' ? 'yekanbakh' : 'vazirmatn';
  if (typeof document === 'undefined') return font;

  const root = document.documentElement;
  root.dataset.appFont = font;
  root.classList.toggle('font-yekanbakh', font === 'yekanbakh');
  root.classList.toggle('font-vazirmatn', font === 'vazirmatn');
  // فوراً روی کل صفحه اعمال شود (قبل از رفرش theme-vars)
  root.style.setProperty('--font-family', FONT_STACK[font]);
  if (document.body) {
    document.body.style.fontFamily = FONT_STACK[font];
  }
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
