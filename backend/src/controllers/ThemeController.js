const AppSetting = require('../models/AppSetting');

function validColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback;
}

function resolveUiFont(value) {
  return String(value || '').trim() === 'yekanbakh' ? 'yekanbakh' : 'vazirmatn';
}

function fontStack(uiFont) {
  if (uiFont === 'yekanbakh') {
    return "'Yekan Bakh FaNum', Tahoma, sans-serif";
  }
  return "'Vazirmatn', Tahoma, sans-serif";
}

/**
 * علامت تومان یکان‌بخ (راهنمای فونت‌ایران): کاراکتر همزه «ء» به‌جای واژه «تومان».
 * در وزیرمتن همان واژه «تومان» نمایش داده می‌شود.
 */
function tomanSuffixCss(uiFont) {
  if (uiFont === 'yekanbakh') {
    // کاراکتر واقعی NBSP + همزه (نه escape متنی) تا JS و CSS درست بخوانند
    return `"${'\u00A0\u0621'}"`;
  }
  return '" تومان"';
}

class ThemeController {
  static async variables(_req, res) {
    const settings = await AppSetting.findOne({ key: 'default' }).lean().catch(() => null);
    const primary = validColor(settings?.themePrimary, '#8E2A3F');
    const primaryLight = validColor(settings?.themePrimaryLight, '#B84A62');
    const primaryDark = validColor(settings?.themePrimaryDark, '#5A1624');
    const gradientFrom = validColor(settings?.themeGradientFrom, '#3D0F18');
    const gradientTo = validColor(settings?.themeGradientTo, '#5A1624');
    const uiFont = resolveUiFont(settings?.uiFont);

    res.type('text/css');
    res.setHeader('Cache-Control', 'no-store');
    res.send([
      ':root {',
      `  --primary: ${primary};`,
      `  --primary-light: ${primaryLight};`,
      `  --primary-dark: ${primaryDark};`,
      `  --primary-glow: color-mix(in srgb, ${primary} 40%, transparent);`,
      `  --primary-bg: color-mix(in srgb, ${primary} 8%, transparent);`,
      `  --primary-bg-soft: color-mix(in srgb, ${primary} 5%, transparent);`,
      `  --primary-bg-strong: color-mix(in srgb, ${primary} 15%, transparent);`,
      `  --border-accent: color-mix(in srgb, ${primary} 30%, transparent);`,
      `  --glow-primary: 0 0 32px color-mix(in srgb, ${primary} 25%, transparent);`,
      `  --text-main: color-mix(in srgb, ${primaryDark} 28%, #111827);`,
      `  --text-sub: color-mix(in srgb, ${primaryDark} 34%, #374151);`,
      `  --text-muted: color-mix(in srgb, ${primary} 26%, #64748B);`,
      `  --text-dim: color-mix(in srgb, ${primary} 18%, #94A3B8);`,
      `  --surface-card: color-mix(in srgb, ${primary} 6%, transparent);`,
      `  --sidebar-bg: linear-gradient(180deg, color-mix(in srgb, ${primaryDark} 38%, #07111F) 0%, color-mix(in srgb, ${gradientFrom} 55%, #08111D) 48%, color-mix(in srgb, ${gradientTo} 42%, #050B14) 100%);`,
      `  --sidebar-text: color-mix(in srgb, ${primaryLight} 72%, #FFFFFF);`,
      `  --sidebar-muted: color-mix(in srgb, ${primaryLight} 48%, #90A4BA);`,
      `  --sidebar-dim: color-mix(in srgb, ${primaryLight} 28%, #64748B);`,
      `  --menu-hover-bg: color-mix(in srgb, ${primary} 12%, transparent);`,
      `  --menu-active-bg: linear-gradient(135deg, color-mix(in srgb, ${primary} 30%, transparent), color-mix(in srgb, ${primaryDark} 18%, transparent));`,
      `  --font-family: ${fontStack(uiFont)};`,
      `  --toman-suffix: ${tomanSuffixCss(uiFont)};`,
      '}',
      'html, body, button, input, select, textarea, .table, .sidebar, .top-nav, .top-header {',
      '  font-family: var(--font-family);',
      '}',
      '.page-header, .day-card-header, .auth-side, .home-hero, .table thead th {',
      `  background: linear-gradient(135deg, ${gradientFrom}, ${gradientTo}) !important;`,
      '}',
    ].join('\n'));
  }
}

module.exports = ThemeController;
