const AppSetting = require('../models/AppSetting');

/**
 * رنگ یکپارچه سامانه — Coloro 125-28-38 (Luminous Blue) → #1B3F8D
 * (کد Hue-Lightness-Chroma؛ مقادیر 38-28-125 همان سه رقم با ترتیب استاندارد Coloro است)
 */
const BRAND = Object.freeze({
  primary: '#1B3F8D',
  primaryLight: '#4D73B5',
  primaryDark: '#122A62',
  gradientFrom: '#0B1A3D',
  gradientTo: '#1B3F8D',
});

function resolveUiFont(value) {
  return String(value || '').trim() === 'yekanbakh' ? 'yekanbakh' : 'vazirmatn';
}

function fontStack(uiFont) {
  if (uiFont === 'yekanbakh') {
    return "'Yekan Bakh FaNum', Tahoma, sans-serif";
  }
  return "'Vazirmatn', Tahoma, sans-serif";
}

function tomanSuffixCss() {
  return `"${'\u00A0ت'}"`;
}

class ThemeController {
  static async variables(_req, res) {
    const settings = await AppSetting.findOne({ key: 'default' }).lean().catch(() => null);
    const { primary, primaryLight, primaryDark, gradientFrom, gradientTo } = BRAND;
    const uiFont = resolveUiFont(settings?.uiFont);

    res.type('text/css');
    res.setHeader('Cache-Control', 'no-store');
    res.send([
      ':root {',
      `  --primary: ${primary};`,
      `  --primary-light: ${primaryLight};`,
      `  --primary-dark: ${primaryDark};`,
      `  --primary-glow: color-mix(in srgb, ${primary} 42%, transparent);`,
      `  --primary-bg: color-mix(in srgb, ${primary} 9%, transparent);`,
      `  --primary-bg-soft: color-mix(in srgb, ${primary} 5%, transparent);`,
      `  --primary-bg-strong: color-mix(in srgb, ${primary} 16%, transparent);`,
      `  --border-accent: color-mix(in srgb, ${primary} 32%, transparent);`,
      `  --glow-primary: 0 0 32px color-mix(in srgb, ${primary} 28%, transparent);`,
      `  --text-main: #0A1628;`,
      `  --text-sub: #1C3550;`,
      `  --text-muted: #5A738C;`,
      `  --text-dim: #8A9DB0;`,
      `  --surface-card: color-mix(in srgb, ${primary} 4%, #ffffff);`,
      `  --sidebar-bg: linear-gradient(185deg, #0B1A3D 0%, #0A1530 55%, #060E1F 100%);`,
      `  --sidebar-text: #E8F1F8;`,
      `  --sidebar-muted: #7EB3D9;`,
      `  --sidebar-dim: #4A7A9E;`,
      `  --menu-hover-bg: color-mix(in srgb, ${primary} 14%, transparent);`,
      `  --menu-active-bg: linear-gradient(135deg, color-mix(in srgb, ${primary} 38%, transparent), color-mix(in srgb, ${primaryDark} 24%, transparent));`,
      `  --font-family: ${fontStack(uiFont)};`,
      `  --toman-suffix: ${tomanSuffixCss()};`,
      '}',
      'html, body {',
      '  font-family: var(--font-family) !important;',
      '  font-weight: 400 !important;',
      '}',
      'body *:not(i):not(.fas):not(.far):not(.fab):not(.fa):not([class*="fa-"]) {',
      '  font-family: inherit !important;',
      '}',
      'body, p, span, a, label, li, td, th, input, select, textarea, button, .btn, .form-control,',
      '.sidebar-link, .card-title, .section-title, .table, .badge, .food-name, .day-name,',
      '.nav-brand-title, .nav-u-name, .modal-title, .auth-card-title, .feature-title {',
      '  font-weight: 400 !important;',
      '}',
      'strong, b, .fw-bold, .ph-title, h1, h2, h3 {',
      '  font-weight: 600 !important;',
      '}',
      '.swal2-popup, [data-sonner-toaster], [data-sonner-toast] {',
      '  font-family: var(--font-family) !important;',
      '  font-weight: 400 !important;',
      '}',
      '.page-header, .day-card-header, .auth-side, .home-hero, .table thead th {',
      `  background: linear-gradient(135deg, ${gradientFrom}, ${gradientTo}) !important;`,
      '}',
      'body.admin-body .sidebar.sidebar-nav-panel {',
      '  background: var(--sidebar-bg) !important;',
      '}',
      'body.admin-body .sidebar-nav-sub-link.is-active {',
      `  background: color-mix(in srgb, ${primary} 28%, transparent) !important;`,
      `  border-color: color-mix(in srgb, ${primary} 45%, transparent) !important;`,
      '}',
    ].join('\n'));
  }
}

module.exports = ThemeController;
module.exports.BRAND = BRAND;
