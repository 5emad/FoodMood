import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';

const TEXT_FIELDS = [
  { key: 'checkoutTitle', label: 'عنوان دکمه پرداخت', max: 40 },
  { key: 'checkoutDescription', label: 'توضیح دکمه پرداخت', max: 160 },
  { key: 'successTitle', label: 'عنوان صفحه پرداخت موفق', max: 60 },
  { key: 'successMessage', label: 'متن صفحه پرداخت موفق', max: 200 },
  { key: 'failureTitle', label: 'عنوان صفحه پرداخت ناموفق', max: 60 },
  { key: 'baleSuccessMessage', label: 'پیام پرداخت موفق در چت ربات بله', max: 300, hint: '{code} = شماره پرداخت، {amount} = مبلغ' },
];

const PREVIEW_STATES = [
  { key: 'checkout', label: 'پیش‌فاکتور' },
  { key: 'paid', label: 'پرداخت موفق' },
  { key: 'failed', label: 'ناموفق' },
];

/** پیش‌نمایش رنگی کوچک هر قالب */
const THUMB = {
  classic: { page: '#F1F4FA', head: 'accent', card: '#fff' },
  minimal: { page: '#fff', head: '#fff', card: '#fff', border: true },
  paper: { page: '#E9E4D8', head: '#FFFEF9', card: '#FFFEF9' },
  ticket: { page: 'soft', head: 'soft2', card: '#fff' },
  gradient: { page: 'gradient', head: '#fff', card: '#fff' },
  bale: { page: '#E6F6F6', head: '#00A3A6', card: '#fff' },
  dark: { page: '#0B1220', head: '#111A2E', card: '#111A2E' },
  glass: { page: 'glass', head: 'rgba(255,255,255,.6)', card: 'rgba(255,255,255,.6)' },
};

function thumbStyle(key, color) {
  const t = THUMB[key] || THUMB.classic;
  const resolve = (v) => {
    if (v === 'accent') return color;
    if (v === 'soft') return `color-mix(in srgb, ${color} 14%, #F8FAFC)`;
    if (v === 'soft2') return `color-mix(in srgb, ${color} 8%, #fff)`;
    if (v === 'gradient') return `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #EC4899))`;
    if (v === 'glass') return `radial-gradient(circle at 20% 20%, color-mix(in srgb, ${color} 50%, #fff), transparent 55%), #EEF2FF`;
    return v;
  };
  return {
    page: { background: resolve(t.page) },
    head: { background: resolve(t.head) },
    card: { background: resolve(t.card), boxShadow: t.border ? '0 0 0 1px #E5E7EB' : '0 2px 6px rgba(15,23,42,.18)' },
  };
}

export default function PaymentAppearance({ appearance, catalog, sandbox, onChange }) {
  const [previewState, setPreviewState] = useState('checkout');
  const [category, setCategory] = useState(() => {
    const current = catalog?.templates?.find((t) => t.key === appearance?.template);
    return current?.category || catalog?.categories?.[0]?.key || 'simple';
  });
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await api('/api/admin/payment-settings/preview', {
        method: 'POST',
        body: JSON.stringify({ appearance, state: previewState, sandbox }),
      }).catch(() => null);
      if (id !== seq.current) return;
      setLoading(false);
      if (res?.success) setHtml(res.data.html);
    }, 300);
    return () => clearTimeout(timer);
  }, [appearance, previewState, sandbox]);

  if (!appearance || !catalog) return null;
  const set = (key, value) => onChange({ ...appearance, [key]: value });
  const templates = catalog.templates.filter((t) => t.category === category);

  return (
    <div className="card pay-appearance">
      <div className="card-header">
        <div className="card-title"><i className="fas fa-palette" /> ظاهر صفحه پرداخت</div>
      </div>
      <div className="card-body pay-appearance-body">
        <div className="pay-appearance-controls">
          <div className="form-label">قالب</div>
          <div className="pay-tpl-cats" role="tablist" aria-label="دسته قالب">
            {catalog.categories.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={category === c.key}
                className={`pay-tpl-cat${category === c.key ? ' is-active' : ''}`}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="pay-tpl-grid" role="radiogroup" aria-label="قالب صفحه پرداخت">
            {templates.map((t) => {
              const st = thumbStyle(t.key, appearance.color);
              const active = appearance.template === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`pay-tpl${active ? ' is-active' : ''}`}
                  onClick={() => set('template', t.key)}
                >
                  <span className="pay-tpl-thumb" style={st.page}>
                    <span className="pay-tpl-thumb-card" style={st.card}>
                      <span className="pay-tpl-thumb-head" style={st.head} />
                      <span className="pay-tpl-thumb-line" />
                      <span className="pay-tpl-thumb-line short" />
                      <span className="pay-tpl-thumb-btn" style={{ background: t.key === 'bale' ? '#00A3A6' : appearance.color }} />
                    </span>
                  </span>
                  <span className="pay-tpl-name">{t.label}</span>
                  {active && <i className="fas fa-circle-check pay-tpl-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="form-label">رنگ اصلی</div>
          <div className="pay-color-row">
            {catalog.colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`pay-color${appearance.color.toUpperCase() === c.toUpperCase() ? ' is-active' : ''}`}
                style={{ background: c }}
                onClick={() => set('color', c)}
                aria-label={`رنگ ${c}`}
                title={c}
              />
            ))}
            <label className="pay-color-custom" title="رنگ دلخواه">
              <input type="color" value={appearance.color} onChange={(e) => set('color', e.target.value.toUpperCase())} aria-label="رنگ دلخواه" />
              <span dir="ltr">{appearance.color}</span>
            </label>
          </div>
          {appearance.template === 'bale' && <p className="pay-appearance-hint">قالب «سبک بله» رنگ ثابت فیروزه‌ای بله را دارد.</p>}

          <div className="pay-appearance-texts">
            {TEXT_FIELDS.map((f) => (
              <label key={f.key} className="pay-appearance-text">
                <span>{f.label}</span>
                {f.max > 100 ? (
                  <textarea className="form-control" rows={2} maxLength={f.max} value={appearance[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <input className="form-control" maxLength={f.max} value={appearance[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />
                )}
                {f.hint && <small dir="rtl">{f.hint}</small>}
              </label>
            ))}
          </div>
        </div>

        <div className="pay-appearance-preview">
          <div className="pay-preview-head">
            <strong><i className="fas fa-eye" /> پیش‌نمایش زنده</strong>
            <div className="pay-preview-states" role="tablist" aria-label="حالت پیش‌نمایش">
              {PREVIEW_STATES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={previewState === s.key}
                  className={previewState === s.key ? 'is-active' : ''}
                  onClick={() => setPreviewState(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`pay-preview-frame${loading ? ' is-loading' : ''}`}>
            {html
              ? <iframe title="پیش‌نمایش صفحه پرداخت" srcDoc={html} sandbox="allow-same-origin" />
              : <div className="pay-preview-empty"><div className="spinner" /></div>}
          </div>
          <p className="pay-appearance-hint">این قالب برای پیش‌فاکتور بله، شبیه‌ساز آزمایشی و صفحه نتیجه پرداخت (بله و درگاه) استفاده می‌شود.</p>
        </div>
      </div>
    </div>
  );
}
