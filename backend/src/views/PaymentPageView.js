/**
 * صفحه‌های پرداخت (پیش‌فاکتور بله / شبیه‌ساز آزمایشی / نتیجه پرداخت) با قالب‌های ظاهری قابل انتخاب.
 * HTML کامل سمت سرور؛ بدون وابستگی به SPA چون بدون نشست (داخل بله یا بعد از بازگشت از بانک) باز می‌شود.
 */

const TEMPLATE_CATEGORIES = [
  { key: 'simple', label: 'ساده' },
  { key: 'receipt', label: 'رسید و بلیت' },
  { key: 'colorful', label: 'رنگی' },
  { key: 'modern', label: 'مدرن' },
];

const TEMPLATES = [
  { key: 'classic', label: 'کلاسیک', category: 'simple' },
  { key: 'minimal', label: 'مینیمال', category: 'simple' },
  { key: 'paper', label: 'رسید کاغذی', category: 'receipt' },
  { key: 'ticket', label: 'بلیت', category: 'receipt' },
  { key: 'gradient', label: 'گرادیان', category: 'colorful' },
  { key: 'bale', label: 'سبک بله', category: 'colorful' },
  { key: 'dark', label: 'تیره', category: 'modern' },
  { key: 'glass', label: 'شیشه‌ای', category: 'modern' },
];

const COLOR_PRESETS = ['#1B3F8D', '#0F766E', '#00A3A6', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#0F172A'];

const DEFAULT_APPEARANCE = {
  template: 'classic',
  color: '#1B3F8D',
  checkoutTitle: 'پرداخت با بله',
  checkoutDescription: 'پرداخت امن از کیف پول یا کارت بانکی داخل اپلیکیشن بله',
  successTitle: 'پرداخت با موفقیت انجام شد',
  successMessage: 'صورتحساب پرداخت‌شده صادر شد و سفارش‌های شما تایید شدند.',
  failureTitle: 'پرداخت انجام نشد',
  baleSuccessMessage: 'پرداخت {code} به مبلغ {amount} با موفقیت ثبت شد. سپاس از شما.',
};

const TEXT_LIMITS = {
  checkoutTitle: 40,
  checkoutDescription: 160,
  successTitle: 60,
  successMessage: 200,
  failureTitle: 60,
  baleSuccessMessage: 300,
};

function normalizeAppearance(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_APPEARANCE };
  if (TEMPLATES.some((t) => t.key === src.template)) out.template = src.template;
  if (/^#[0-9a-f]{6}$/i.test(String(src.color || ''))) out.color = String(src.color).toUpperCase();
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (src[key] !== undefined) {
      const text = String(src[key] ?? '').trim().slice(0, max);
      if (text) out[key] = text;
    }
  }
  return out;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function faNumber(n) {
  return Number(n || 0).toLocaleString('fa-IR');
}

function money(n) {
  return `${faNumber(n)} تومان`;
}

function jalali(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString('fa-IR-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const ICONS = {
  checkout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v1H3V7Zm0 3h18v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7Zm12 4a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2h-3Z"/></svg>',
  paid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7-5.5 5.5a1 1 0 0 1-1.4 0l-2.5-2.5a1 1 0 1 1 1.4-1.4l1.8 1.8 4.8-4.8a1 1 0 1 1 1.4 1.4Z"/></svg>',
  failed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 12.1a1 1 0 0 1-1.4 1.4L12 13.4l-2.1 2.1a1 1 0 0 1-1.4-1.4l2.1-2.1-2.1-2.1a1 1 0 1 1 1.4-1.4l2.1 2.1 2.1-2.1a1 1 0 1 1 1.4 1.4L13.4 12l2.1 2.1Z"/></svg>',
  waiting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6V7a1 1 0 1 0-2 0v6c0 .3.1.5.3.7l3 3a1 1 0 0 0 1.4-1.4L13 12.6Z"/></svg>',
};

const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl;background:var(--page);color:var(--ink);
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  -webkit-font-smoothing:antialiased}
.pp-card{position:relative;width:min(420px,100%);background:var(--card);color:var(--ink);border-radius:var(--radius);
  box-shadow:var(--shadow);overflow:hidden}
.pp-head{padding:26px 22px 18px;text-align:center;background:var(--head-bg);color:var(--head-ink)}
.pp-org{font-size:.82rem;font-weight:700;opacity:.85;margin-bottom:14px;letter-spacing:.2px}
.pp-ico{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;
  background:var(--ico-bg);color:var(--ico-ink)}
.pp-ico svg{width:38px;height:38px;fill:currentColor}
.pp-state-paid .pp-ico{color:var(--ok)}
.pp-state-failed .pp-ico{color:var(--bad)}
.pp-title{margin:0;font-size:1.12rem;font-weight:800;line-height:1.7}
.pp-sub{margin:6px 0 0;font-size:.84rem;line-height:1.9;opacity:.85}
.pp-amount{margin:0 22px;padding:14px 16px;border-radius:calc(var(--radius) * .6);background:var(--amount-bg);
  display:flex;align-items:center;justify-content:space-between;gap:10px;transform:translateY(-1px)}
.pp-amount span{font-size:.8rem;color:var(--muted)}
.pp-amount strong{font-size:1.25rem;color:var(--accent-ink);font-weight:800}
.pp-body{padding:16px 22px 6px}
.pp-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;font-size:.85rem;border-bottom:1px dashed var(--line)}
.pp-row:last-child{border-bottom:0}
.pp-row span{color:var(--muted)}
.pp-row strong{font-weight:700;text-align:left}
.pp-items{margin:6px 0 2px;padding:10px 12px;border-radius:12px;background:var(--soft);font-size:.8rem}
.pp-item{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
.pp-item span{color:var(--muted)}
.pp-note{margin:10px 0 0;font-size:.8rem;line-height:1.9;color:var(--muted);text-align:center}
.pp-actions{padding:14px 22px 22px;display:flex;flex-direction:column;gap:8px}
.pp-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;padding:10px 16px;border-radius:var(--btn-radius);
  border:0;font:inherit;font-weight:800;font-size:.95rem;cursor:pointer;text-decoration:none;background:var(--btn-bg);color:var(--btn-ink);
  box-shadow:var(--btn-shadow);transition:filter .15s,transform .15s}
.pp-btn:hover{filter:brightness(1.06)}
.pp-btn:active{transform:translateY(1px)}
.pp-btn small{display:block;font-weight:500;font-size:.72rem;opacity:.85}
.pp-btn-ghost{background:transparent;color:var(--accent-ink);box-shadow:none;border:1px solid var(--line)}
.pp-btn-danger{background:transparent;color:var(--bad);box-shadow:none;border:1px solid color-mix(in srgb,var(--bad) 35%,transparent)}
.pp-btn-label{display:flex;flex-direction:column;align-items:center;line-height:1.5}
.pp-sandbox{margin:0 22px 4px;padding:8px 12px;border-radius:10px;font-size:.76rem;line-height:1.8;text-align:center;
  background:#FEF3C7;color:#92400E;border:1px dashed #F59E0B}
.pp-foot{padding:0 22px 18px;text-align:center;font-size:.72rem;color:var(--muted)}
.pp-foot b{color:var(--accent-ink)}
.pp-countdown{font-size:.75rem;color:var(--muted);text-align:center}
.pp-spin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-inline-end-color:transparent;display:inline-block;animation:pp-spin .8s linear infinite}
@keyframes pp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pp-spin{animation:none}}
`;

/** هر قالب = مجموعه‌ای از متغیرها + چند قانون اختصاصی */
const TEMPLATE_CSS = {
  classic: `
body{--page:#F1F4FA;--card:#fff;--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--soft:#F8FAFC;--radius:20px;
  --shadow:0 18px 50px rgba(15,23,42,.14);--head-bg:var(--accent);--head-ink:#fff;--ico-bg:rgba(255,255,255,.95);--ico-ink:var(--accent);
  --amount-bg:#fff;--accent-ink:var(--accent);--btn-bg:var(--accent);--btn-ink:#fff;--btn-radius:14px;--btn-shadow:0 8px 20px color-mix(in srgb,var(--accent) 35%,transparent);
  --ok:#16A34A;--bad:#DC2626}
.pp-amount{margin-top:-18px;box-shadow:0 8px 24px rgba(15,23,42,.10);position:relative}
.pp-head{padding-bottom:36px}`,
  minimal: `
body{--page:#FFFFFF;--card:#fff;--ink:#111827;--muted:#6B7280;--line:#EEF0F3;--soft:#F9FAFB;--radius:16px;
  --shadow:0 0 0 1px #EEF0F3;--head-bg:#fff;--head-ink:#111827;--ico-bg:color-mix(in srgb,var(--accent) 10%,#fff);--ico-ink:var(--accent);
  --amount-bg:#F9FAFB;--accent-ink:var(--accent);--btn-bg:var(--accent);--btn-ink:#fff;--btn-radius:10px;--btn-shadow:none;--ok:#16A34A;--bad:#DC2626}
.pp-org{color:var(--accent)}`,
  paper: `
body{--page:#E9E4D8;--card:#FFFEF9;--ink:#1F2937;--muted:#6B7280;--line:#E7E1D4;--soft:#F7F3EA;--radius:4px;
  --shadow:0 18px 40px rgba(60,50,30,.18);--head-bg:transparent;--head-ink:#1F2937;--ico-bg:transparent;--ico-ink:var(--accent);
  --amount-bg:#F7F3EA;--accent-ink:#1F2937;--btn-bg:#1F2937;--btn-ink:#fff;--btn-radius:6px;--btn-shadow:none;--ok:#15803D;--bad:#B91C1C}
.pp-card{overflow:visible;margin:12px 0}
.pp-card::before,.pp-card::after{content:'';position:absolute;left:0;right:0;height:10px;background-size:16px 10px;background-repeat:repeat-x}
.pp-card::before{top:-9px;background-image:radial-gradient(circle at 8px 0,transparent 7px,#FFFEF9 7.5px)}
.pp-card::after{bottom:-9px;background-image:radial-gradient(circle at 8px 10px,transparent 7px,#FFFEF9 7.5px)}
.pp-head{border-bottom:2px dashed var(--line)}
.pp-title,.pp-amount strong,.pp-row strong{font-family:ui-monospace,Consolas,Vazirmatn,monospace}
.pp-state-paid .pp-head::after{content:'پرداخت شد';position:absolute;top:22px;left:18px;transform:rotate(-14deg);border:2px solid #15803D;color:#15803D;
  border-radius:6px;padding:1px 8px;font-weight:800;font-size:.8rem;opacity:.8}`,
  ticket: `
body{--page:color-mix(in srgb,var(--accent) 12%,#F8FAFC);--card:#fff;--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--soft:#F8FAFC;--radius:22px;
  --shadow:0 20px 50px rgba(15,23,42,.16);--head-bg:color-mix(in srgb,var(--accent) 8%,#fff);--head-ink:#0F172A;--ico-bg:var(--accent);--ico-ink:#fff;
  --amount-bg:transparent;--accent-ink:var(--accent);--btn-bg:var(--accent);--btn-ink:#fff;--btn-radius:999px;--btn-shadow:0 8px 18px color-mix(in srgb,var(--accent) 30%,transparent);
  --ok:#16A34A;--bad:#DC2626}
.pp-state-paid .pp-ico,.pp-state-failed .pp-ico{color:#fff}
.pp-state-paid .pp-ico{background:var(--ok)}.pp-state-failed .pp-ico{background:var(--bad)}
.pp-amount{position:relative;margin:0;border-radius:0;border-top:2px dashed var(--line);border-bottom:2px dashed var(--line);padding:16px 22px}
.pp-amount::before,.pp-amount::after{content:'';position:absolute;top:50%;width:26px;height:26px;border-radius:50%;background:var(--page);transform:translateY(-50%)}
.pp-amount::before{right:-13px}.pp-amount::after{left:-13px}`,
  gradient: `
body{--page:linear-gradient(135deg,color-mix(in srgb,var(--accent) 85%,#000) 0%,var(--accent) 45%,color-mix(in srgb,var(--accent) 55%,#EC4899) 100%);
  --card:#fff;--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--soft:#F8FAFC;--radius:26px;--shadow:0 30px 60px rgba(0,0,0,.25);
  --head-bg:transparent;--head-ink:#0F172A;--ico-bg:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#EC4899));--ico-ink:#fff;
  --amount-bg:color-mix(in srgb,var(--accent) 7%,#fff);--accent-ink:var(--accent);
  --btn-bg:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#EC4899));--btn-ink:#fff;--btn-radius:16px;
  --btn-shadow:0 12px 26px color-mix(in srgb,var(--accent) 40%,transparent);--ok:#16A34A;--bad:#DC2626}
body{background:var(--page)}
.pp-state-paid .pp-ico,.pp-state-failed .pp-ico{color:#fff}
.pp-state-paid .pp-ico{background:linear-gradient(135deg,#22C55E,#15803D)}.pp-state-failed .pp-ico{background:linear-gradient(135deg,#F87171,#B91C1C)}`,
  bale: `
body{--accent:#00A3A6;--page:#E6F6F6;--card:#fff;--ink:#0B2A2B;--muted:#5B7778;--line:#DCEDED;--soft:#F2FAFA;--radius:18px;
  --shadow:0 14px 34px rgba(0,80,82,.14);--head-bg:linear-gradient(180deg,#00B5B8,#008E91);--head-ink:#fff;--ico-bg:rgba(255,255,255,.18);--ico-ink:#fff;
  --amount-bg:#F2FAFA;--accent-ink:#008E91;--btn-bg:#00A3A6;--btn-ink:#fff;--btn-radius:12px;--btn-shadow:0 8px 18px rgba(0,163,166,.3);
  --ok:#fff;--bad:#fff}
.pp-state-failed .pp-head{background:linear-gradient(180deg,#F87171,#DC2626)}
.pp-head{padding-top:30px}
.pp-org::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#7CF2E4;margin-inline-end:6px;vertical-align:middle}`,
  dark: `
body{--page:#0B1220;--card:#111A2E;--ink:#E5E7EB;--muted:#94A3B8;--line:#22304A;--soft:#0E1627;--radius:20px;
  --shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 1px #1E2A44;--head-bg:transparent;--head-ink:#F8FAFC;
  --ico-bg:color-mix(in srgb,var(--accent) 22%,#111A2E);--ico-ink:color-mix(in srgb,var(--accent) 60%,#fff);
  --amount-bg:#0E1627;--accent-ink:color-mix(in srgb,var(--accent) 55%,#fff);--btn-bg:var(--accent);--btn-ink:#fff;--btn-radius:14px;
  --btn-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 60%,#fff),0 10px 28px color-mix(in srgb,var(--accent) 45%,transparent);--ok:#4ADE80;--bad:#F87171}
.pp-btn-ghost{color:#E5E7EB}`,
  glass: `
body{--page:radial-gradient(circle at 15% 20%,color-mix(in srgb,var(--accent) 55%,#fff) 0,transparent 45%),
  radial-gradient(circle at 85% 80%,color-mix(in srgb,var(--accent) 45%,#F472B6) 0,transparent 45%),#EEF2FF;
  --card:rgba(255,255,255,.62);--ink:#0F172A;--muted:#475569;--line:rgba(15,23,42,.10);--soft:rgba(255,255,255,.55);--radius:24px;
  --shadow:0 24px 60px rgba(15,23,42,.18),inset 0 1px 0 rgba(255,255,255,.7);--head-bg:transparent;--head-ink:#0F172A;
  --ico-bg:rgba(255,255,255,.75);--ico-ink:var(--accent);--amount-bg:rgba(255,255,255,.7);--accent-ink:var(--accent);
  --btn-bg:var(--accent);--btn-ink:#fff;--btn-radius:16px;--btn-shadow:0 10px 24px color-mix(in srgb,var(--accent) 35%,transparent);--ok:#16A34A;--bad:#DC2626}
body{background:var(--page)}
.pp-card{backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.6)}`,
};

/**
 * @param {object} view
 *  state: 'checkout' | 'waiting' | 'paid' | 'failed'
 *  payment: serialized payment (code, amount, periodLabel, scope, items, referenceId, paidAt, createdAt)
 *  orgName, appearance, sandbox, message,
 *  actions: [{ kind: 'link'|'form', href, label, hint, style, method, fields }]
 *  pollUrl, redirectUrl, redirectSeconds
 */
function renderPaymentPage(view = {}) {
  const appearance = normalizeAppearance(view.appearance);
  const state = ['checkout', 'waiting', 'paid', 'failed'].includes(view.state) ? view.state : 'checkout';
  const p = view.payment || {};
  const titles = {
    checkout: 'پیش‌فاکتور پرداخت',
    waiting: 'در انتظار تایید پرداخت',
    paid: appearance.successTitle,
    failed: appearance.failureTitle,
  };
  const subs = {
    checkout: appearance.checkoutDescription,
    waiting: 'پرداخت را در بله کامل کنید؛ این صفحه پس از تایید خودکار به‌روز می‌شود.',
    paid: appearance.successMessage,
    failed: view.message || 'در صورت کسر وجه، مبلغ توسط بانک برگشت داده می‌شود.',
  };

  const rows = [
    ['شماره پرداخت', p.code],
    ['بابت', p.periodLabel],
    p.statementNumber ? ['شناسه صورتحساب', p.statementNumber] : null,
    state === 'paid' && p.referenceId ? ['کد پیگیری', p.referenceId] : null,
    state === 'paid' && p.paidAt ? ['تاریخ پرداخت', jalali(p.paidAt)] : ['تاریخ', jalali(p.createdAt)],
  ].filter((r) => r && r[1]);

  const items = Array.isArray(p.items) ? p.items.slice(0, 8) : [];
  const moreItems = Array.isArray(p.items) ? Math.max(0, p.items.length - items.length) : 0;

  const actions = (view.actions || []).map((a) => {
    const cls = `pp-btn${a.style === 'ghost' ? ' pp-btn-ghost' : a.style === 'danger' ? ' pp-btn-danger' : ''}`;
    const label = `<span class="pp-btn-label">${esc(a.label)}${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</span>`;
    if (a.kind === 'form') {
      const fields = Object.entries(a.fields || {})
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
      return `<form method="post" action="${esc(a.href)}">${fields}<button type="submit" class="${cls}">${label}</button></form>`;
    }
    const target = a.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="${cls}" href="${esc(a.href)}"${target}>${label}</a>`;
  }).join('');

  const script = [];
  if (view.pollUrl) {
    script.push(`(function(){var u=${JSON.stringify(view.pollUrl)};var n=0;function t(){n++;fetch(u,{cache:'no-store',credentials:'same-origin'})
.then(function(r){return r.json()}).then(function(d){if(d&&d.status&&d.status!=='initiated'){location.reload();return}if(n<180)setTimeout(t,4000)})
.catch(function(){if(n<180)setTimeout(t,6000)})}setTimeout(t,4000)})();`);
  }
  if (view.redirectUrl && view.redirectSeconds) {
    script.push(`(function(){var s=${Number(view.redirectSeconds)};var el=document.getElementById('pp-cd');function t(){if(el)el.textContent=s.toLocaleString('fa-IR');
if(s<=0){location.replace(${JSON.stringify(view.redirectUrl)});return}s--;setTimeout(t,1000)}t()})();`);
  }

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titles[state])} — ${esc(view.orgName || 'سامانه تغذیه')}</title>
<link rel="stylesheet" href="/vendor/vazirmatn/vazirmatn.css">
<style>body{--accent:${esc(appearance.color)}}${BASE_CSS}${TEMPLATE_CSS[appearance.template] || TEMPLATE_CSS.classic}</style>
</head>
<body class="pp-tpl-${esc(appearance.template)} pp-state-${state}">
<main class="pp-card" aria-live="polite">
  <div class="pp-head">
    <div class="pp-org">${esc(view.orgName || 'سامانه تغذیه')}</div>
    <div class="pp-ico">${ICONS[state]}</div>
    <h1 class="pp-title">${esc(titles[state])}</h1>
    <p class="pp-sub">${esc(subs[state])}</p>
  </div>
  <div class="pp-amount"><span>${state === 'paid' ? 'مبلغ پرداخت‌شده' : 'مبلغ قابل پرداخت'}</span><strong>${money(p.amount)}</strong></div>
  ${view.sandbox ? '<div class="pp-sandbox" style="margin-top:12px">حالت آزمایشی — هیچ وجه واقعی جابه‌جا نمی‌شود</div>' : ''}
  <div class="pp-body">
    ${rows.map(([k, v]) => `<div class="pp-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}
    ${items.length ? `<div class="pp-items">${items.map((i) => `<div class="pp-item"><span>${esc(i.foodName || 'سفارش')}${i.jalaliDate ? ` — ${esc(i.jalaliDate)}` : ''}</span><b>${money(i.amount)}</b></div>`).join('')}${moreItems ? `<div class="pp-item"><span>و ${faNumber(moreItems)} قلم دیگر</span></div>` : ''}</div>` : ''}
  </div>
  <div class="pp-actions">
    ${actions}
    ${state === 'waiting' ? '<div class="pp-countdown"><span class="pp-spin"></span> در انتظار تایید بله…</div>' : ''}
    ${view.redirectUrl && view.redirectSeconds ? `<div class="pp-countdown">بازگشت خودکار به سامانه تا <span id="pp-cd"></span> ثانیه دیگر</div>` : ''}
  </div>
  <div class="pp-foot">پرداخت امن در <b>${esc(view.orgName || 'سامانه تغذیه')}</b></div>
</main>
${script.length ? `<script>${script.join('\n')}</script>` : ''}
</body></html>`;
}

/** نمونهٔ پیش‌نمایش برای پنل مدیر */
function previewPayment() {
  return {
    code: 'PAY-1024',
    amount: 450000,
    periodLabel: 'سبد خرید — ۳ سفارش',
    referenceId: '78451236',
    paidAt: new Date(),
    createdAt: new Date(),
    items: [
      { foodName: 'جوجه کباب', jalaliDate: '۱۴۰۵/۰۷/۲۵', amount: 150000 },
      { foodName: 'مرغ ترش', jalaliDate: '۱۴۰۵/۰۷/۲۶', amount: 150000 },
      { foodName: 'قرمه‌سبزی', jalaliDate: '۱۴۰۵/۰۷/۲۷', amount: 150000 },
    ],
  };
}

module.exports = {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  COLOR_PRESETS,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  renderPaymentPage,
  previewPayment,
};
