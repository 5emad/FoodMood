import { useEffect } from 'react';
import { faDigits } from '../utils/format';
import BrandLogo from './BrandLogo';

const PRESETS = {
  404: { title: 'صفحه پیدا نشد', text: 'آدرسی که وارد کرده‌اید وجود ندارد، حذف شده یا جابه‌جا شده است.' },
  403: { title: 'دسترسی غیرمجاز', text: 'شما اجازه‌ی مشاهده‌ی این بخش را ندارید. اگر فکر می‌کنید اشتباهی رخ داده، با مدیر سامانه تماس بگیرید.' },
};

function ForbiddenArt() {
  return (
    <svg className="fm-error-art" viewBox="0 0 190 150" aria-hidden="true">
      <ellipse cx="95" cy="138" rx="62" ry="7" fill="#e8edf8" />
      <path d="M95 14 150 34v38c0 33-24 55-55 64-31-9-55-31-55-64V34z" fill="#e8edf8" stroke="#c3cbe2" strokeWidth="3" />
      <path d="M95 26 140 42v30c0 26-19 44-45 52-26-8-45-26-45-52V42z" fill="#1b3f8d" />
      <rect x="74" y="68" width="42" height="34" rx="7" fill="#fff" />
      <path d="M82 68v-9a13 13 0 0 1 26 0v9" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="95" cy="82" r="5" fill="#1b3f8d" />
      <rect x="92.5" y="84" width="5" height="10" rx="2.5" fill="#1b3f8d" />
      <circle cx="158" cy="22" r="6" fill="#f5b301" />
      <circle cx="28" cy="40" r="4" fill="#4d73b5" opacity=".5" />
    </svg>
  );
}

function NotFoundArt() {
  return (
    <svg className="fm-error-art" viewBox="0 0 190 150" aria-hidden="true">
      <ellipse cx="95" cy="138" rx="66" ry="7" fill="#e8edf8" />
      <circle cx="95" cy="80" r="52" fill="#e8edf8" stroke="#c3cbe2" strokeWidth="3" />
      <circle cx="95" cy="80" r="36" fill="#fff" stroke="#dde3f0" strokeWidth="3" />
      <path d="M84 70a11 11 0 1 1 15 10c-3 2-4 4-4 7" fill="none" stroke="#1b3f8d" strokeWidth="6" strokeLinecap="round" />
      <circle cx="95" cy="98" r="4" fill="#1b3f8d" />
      <g stroke="#4d73b5" strokeWidth="5" strokeLinecap="round"><path d="M28 40v38" /><path d="M22 40v14a6 6 0 0 0 12 0V40" fill="none" /></g>
      <path d="M162 40c-8 4-10 16-10 24h10v14" fill="none" stroke="#4d73b5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="none" stroke="#f5b301" strokeWidth="4" strokeLinecap="round"><path d="M86 22c-4-4 4-7 0-12" /><path d="M104 22c-4-4 4-7 0-12" /></g>
    </svg>
  );
}

/**
 * Full-page error screen (404 / 403) in the system's navy brand.
 * actions: [{ label, href, primary }]
 */
export default function ErrorScreen({ code = 404, title, text, actions }) {
  useEffect(() => {
    document.body.classList.add('fm-auth-page');
    return () => document.body.classList.remove('fm-auth-page');
  }, []);

  const preset = PRESETS[code] || PRESETS[404];
  const list = actions?.length ? actions : [{ label: 'بازگشت به صفحه ورود', href: '/login', primary: true }];

  return (
    <main className="fm-auth-bg">
      <div className="fm-auth-wrap">
        <section className="fm-auth-card fm-error-card" aria-labelledby="fm-error-title">
          {code === 403 ? <ForbiddenArt /> : <NotFoundArt />}
          <div className="fm-error-code" aria-hidden="true">{faDigits(code, { useGrouping: false })}</div>
          <h1 id="fm-error-title">{title || preset.title}</h1>
          <p className="fm-error-text">{text || preset.text}</p>
          <div className="fm-error-actions">
            {list.map((a) => (
              <a key={a.href + a.label} href={a.href} className={`fm-btn${a.primary ? '' : ' fm-btn-outline'}`}>{a.label}</a>
            ))}
          </div>
        </section>
      </div>
      <div className="fm-auth-version fm-error-brand">
        <BrandLogo size={24} /> <span>سامانه تغذیه</span>
      </div>
    </main>
  );
}
