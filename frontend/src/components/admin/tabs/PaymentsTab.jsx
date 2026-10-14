import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import EmptyState from '../shared/EmptyState';
import Pagination from '../shared/Pagination';
import PaymentInvoice from '../../payment/PaymentInvoice';
import PaymentAppearance from '../payments/PaymentAppearance';
import { faDigits, jdate, money } from '../../../utils/format';
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_PROVIDER_LABEL,
  PAYMENT_SCOPE_LABEL,
  PAYMENT_STATUS_CLASS,
  PAYMENT_STATUS_LABEL,
} from '../../../lib/payments';

const FILTER_DEFAULTS = { status: '', method: '', scope: '', q: '' };

function Toggle({ id, checked, onChange, label, disabled }) {
  return (
    <label className="finance-toggle" htmlFor={id}>
      <input type="checkbox" id={id} checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="finance-toggle-ui" />
      <span className="finance-toggle-text">{label}</span>
    </label>
  );
}

function Note({ children }) {
  return (
    <p className="finance-sidebar-note">
      <i className="fas fa-circle-info" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function PaymentSettings() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState(null);
  const [secrets, setSecrets] = useState({ botToken: '', providerToken: '', merchantId: '' });
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    api('/api/admin/payment-settings').then((res) => {
      if (res.success) setCfg(res.data);
      else toast(res.message || 'دریافت تنظیمات پرداخت ناموفق بود', 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cfg) return <AdminSpinner />;

  const set = (section, key, value) => setCfg((c) => ({ ...c, [section]: { ...c[section], [key]: value } }));

  async function save() {
    setSaving(true);
    const res = await api('/api/admin/payment-settings', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: cfg.enabled,
        scopes: cfg.scopes,
        card: cfg.card,
        bale: { enabled: cfg.bale.enabled, sandbox: cfg.bale.sandbox, botToken: secrets.botToken, providerToken: secrets.providerToken },
        appearance: cfg.appearance,
        gateway: {
          enabled: cfg.gateway.enabled,
          provider: cfg.gateway.provider,
          sandbox: cfg.gateway.sandbox,
          merchantId: secrets.merchantId,
        },
      }),
    });
    setSaving(false);
    if (!res.success) return toast(res.message || 'ذخیره ناموفق بود', 'error');
    setCfg(res.data);
    setSecrets({ botToken: '', providerToken: '', merchantId: '' });
    toast(res.message || 'ذخیره شد', 'success');
    if (res.data.enabled && !res.data.active) {
      toast('پرداخت روشن است ولی هیچ روش کامل/محل پرداختی فعال نیست؛ دکمه پرداخت به کاربران نمایش داده نمی‌شود', 'error');
    }
  }

  async function registerWebhook() {
    setRegistering(true);
    const res = await api('/api/admin/payment-settings/bale-webhook', { method: 'POST' });
    setRegistering(false);
    if (!res.success) return toast(res.message || 'ثبت وب‌هوک ناموفق بود', 'error');
    setCfg(res.data);
    toast(res.message || 'وب‌هوک ثبت شد', 'success');
  }

  const off = !cfg.enabled;
  const locked = !cfg.canEditSensitive;
  const lockTitle = locked ? 'فقط سوپر ادمین می‌تواند این مورد را تغییر دهد' : undefined;

  return (
    <div className="pay-settings">
      {locked && (
        <p className="pay-sandbox-warning">
          <i className="fas fa-lock" /> شماره کارت، توکن‌ها، کد پذیرنده و حالت‌های آزمایشی فقط توسط سوپر ادمین قابل تغییر هستند.
        </p>
      )}
      <div className="card pay-settings-overview">
        <div className="card-header"><div className="card-title"><i className="fas fa-power-off" /> وضعیت کلی</div></div>
        <div className="card-body pay-settings-overview-body">
          <div className="pay-settings-overview-main">
            <Toggle id="payEnabled" checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="قابلیت پرداخت فعال باشد" />
            <div className="pay-settings-ready">
              وضعیت فعلی:{' '}
              {cfg.active
                ? <span className="badge badge-success">فعال برای کاربران</span>
                : <span className="badge badge-gray">نمایش داده نمی‌شود</span>}
            </div>
            <Note>اگر غیرفعال باشد، دکمه و بخش پرداخت به کاربران نمایش داده نمی‌شود و سامانه مثل قبل کار می‌کند. با فعال بودن پرداخت، نمایش قیمت برای کاربران اجباری است.</Note>
          </div>
          <div className={`pay-settings-group${off ? ' is-muted' : ''}`}>
            <div className="form-label">پرداخت از کجا انجام شود؟</div>
            <Toggle id="payScopeCart" checked={cfg.scopes.cart} disabled={off} onChange={(v) => set('scopes', 'cart', v)} label="سبد خرید — بلافاصله بعد از رزرو غذا (سفارش پس از پرداخت خودکار تایید می‌شود)" />
            <Toggle id="payScopeWeek" checked={cfg.scopes.week} disabled={off} onChange={(v) => set('scopes', 'week', v)} label="صورتحساب هفتگی" />
            <Toggle id="payScopeMonth" checked={cfg.scopes.month} disabled={off} onChange={(v) => set('scopes', 'month', v)} label="صورتحساب ماهیانه (پرداخت‌های هفتگی از آن کسر می‌شود)" />
          </div>
        </div>
      </div>

      <div className={`pay-methods-grid${off ? ' is-muted' : ''}`}>
        <div className="card pay-settings-card">
          <div className="card-header"><div className="card-title"><i className="fas fa-credit-card" /> کارت به کارت</div></div>
          <div className="card-body">
            <Toggle id="payCardOn" checked={cfg.card.enabled} disabled={off} onChange={(v) => set('card', 'enabled', v)} label="فعال" />
            <label className="form-label" htmlFor="payCardNumber">شماره کارت مقصد</label>
            <input id="payCardNumber" disabled={locked} title={lockTitle} className="form-control" dir="ltr" inputMode="numeric" maxLength={19} value={cfg.card.cardNumber} onChange={(e) => set('card', 'cardNumber', e.target.value)} placeholder="6037-0000-0000-0000" />
            <label className="form-label" htmlFor="payCardHolder">به نام</label>
            <input id="payCardHolder" disabled={locked} title={lockTitle} className="form-control" value={cfg.card.cardHolder} onChange={(e) => set('card', 'cardHolder', e.target.value)} />
            <label className="form-label" htmlFor="payCardBank">نام بانک</label>
            <input id="payCardBank" className="form-control" value={cfg.card.bankName} onChange={(e) => set('card', 'bankName', e.target.value)} />
            <label className="form-label" htmlFor="payCardSheba">شماره شبا (اختیاری)</label>
            <input id="payCardSheba" disabled={locked} title={lockTitle} className="form-control" dir="ltr" value={cfg.card.sheba} onChange={(e) => set('card', 'sheba', e.target.value)} placeholder="IR000000000000000000000000" />
            <label className="form-label" htmlFor="payCardNote">توضیح برای کاربر (اختیاری)</label>
            <input id="payCardNote" className="form-control" value={cfg.card.note} onChange={(e) => set('card', 'note', e.target.value)} />
            <Note>کاربر تصویر رسید را بارگذاری می‌کند و پس از تایید شما، صورتحساب پرداخت‌شده صادر می‌شود.</Note>
          </div>
        </div>

        <div className="card pay-settings-card">
          <div className="card-header"><div className="card-title"><i className="fas fa-comment-dollar" /> پرداخت با بله</div></div>
          <div className="card-body">
            <Toggle id="payBaleOn" checked={cfg.bale.enabled} disabled={off} onChange={(v) => set('bale', 'enabled', v)} label="فعال" />
            <Toggle id="payBaleSandbox" disabled={locked} checked={cfg.bale.sandbox} onChange={(v) => set('bale', 'sandbox', v)} label="حالت آزمایشی (شبیه‌ساز داخلی) — بدون ربات، توکن و HTTPS" />
            {cfg.bale.sandbox && (
              <p className="pay-sandbox-warning">
                <i className="fas fa-flask" /> در حالت آزمایشی پرداخت در یک شبیه‌ساز انجام می‌شود و <b>هیچ وجهی دریافت نمی‌شود</b>. پیش از استفاده واقعی خاموشش کنید.
              </p>
            )}
            <label className="form-label" htmlFor="payBaleBot">توکن ربات (از BotFather بله)</label>
            <input
              id="payBaleBot"
              disabled={locked}
              className={`form-control${cfg.bale.hasBotToken ? ' ph-rtl' : ''}`}
              dir="ltr"
              type="password"
              autoComplete="off"
              value={secrets.botToken}
              onChange={(e) => setSecrets({ ...secrets, botToken: e.target.value })}
              placeholder={cfg.bale.hasBotToken ? 'ثبت شده — برای تغییر مقدار جدید وارد کنید' : '123456789:ABCdef...'}
            />
            <label className="form-label" htmlFor="payBaleProvider">توکن پرداخت (Provider Token)</label>
            <input
              id="payBaleProvider"
              disabled={locked}
              className={`form-control${cfg.bale.hasProviderToken ? ' ph-rtl' : ''}`}
              dir="ltr"
              type="password"
              autoComplete="off"
              value={secrets.providerToken}
              onChange={(e) => setSecrets({ ...secrets, providerToken: e.target.value })}
              placeholder={cfg.bale.hasProviderToken ? 'ثبت شده — برای تغییر مقدار جدید وارد کنید' : 'WALLET-...'}
            />
            <div className="pay-settings-webhook">
              <span>
                وب‌هوک تایید پرداخت:{' '}
                {cfg.bale.webhookRegisteredAt
                  ? <span className="badge badge-success">ثبت شده ({jdate(cfg.bale.webhookRegisteredAt)})</span>
                  : <span className="badge badge-warning">ثبت نشده</span>}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={registerWebhook} disabled={locked || registering || !cfg.bale.hasBotToken} title={lockTitle}>
                <i className={`fas ${registering ? 'fa-circle-notch fa-spin' : 'fa-link'}`} /> ثبت وب‌هوک
              </button>
            </div>
            <Note>
              ابتدا توکن‌ها را ذخیره و سپس وب‌هوک را ثبت کنید. سامانه باید با HTTPS در اینترنت در دسترس باشد. برای آزمایش از توکن
              {' '}<code className="pay-code" dir="ltr">WALLET-TEST-1111111111111111</code>{' '}
              استفاده کنید.
            </Note>
          </div>
        </div>

        <div className="card pay-settings-card">
          <div className="card-header"><div className="card-title"><i className="fas fa-building-columns" /> درگاه بانکی</div></div>
          <div className="card-body">
            <Toggle id="payGwOn" checked={cfg.gateway.enabled} disabled={off} onChange={(v) => set('gateway', 'enabled', v)} label="فعال" />
            <label className="form-label" htmlFor="payGwProvider">درگاه</label>
            <select id="payGwProvider" disabled={locked} title={lockTitle} className="form-control" value={cfg.gateway.provider} onChange={(e) => set('gateway', 'provider', e.target.value)}>
              {cfg.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <label className="form-label" htmlFor="payGwMerchant">کد پذیرنده (Merchant ID)</label>
            <input
              id="payGwMerchant"
              disabled={locked}
              className={`form-control${cfg.gateway.hasMerchantId ? ' ph-rtl' : ''}`}
              dir="ltr"
              type="password"
              autoComplete="off"
              value={secrets.merchantId}
              onChange={(e) => setSecrets({ ...secrets, merchantId: e.target.value })}
              placeholder={cfg.gateway.hasMerchantId ? `ثبت شده (${cfg.gateway.merchantIdHint}) — برای تغییر وارد کنید` : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            />
            <Toggle id="payGwSandbox" disabled={locked} checked={cfg.gateway.sandbox} onChange={(v) => set('gateway', 'sandbox', v)} label="حالت آزمایشی (Sandbox) — بدون انتقال وجه واقعی" />
            {cfg.gateway.sandbox && (
              <p className="pay-sandbox-warning">
                <i className="fas fa-flask" /> درگاه آزمایشی است و <b>هیچ وجهی دریافت نمی‌شود</b>. پیش از استفاده واقعی خاموشش کنید.
              </p>
            )}
            <Note>در حالت آزمایشی نیازی به کد پذیرنده نیست. پس از پرداخت، کاربر به سامانه برمی‌گردد و صورتحساب پرداخت‌شده صادر می‌شود.</Note>
          </div>
        </div>
      </div>

      <PaymentAppearance
        appearance={cfg.appearance}
        catalog={cfg.appearanceCatalog}
        sandbox={cfg.bale.sandbox}
        onChange={(appearance) => setCfg((c) => ({ ...c, appearance }))}
      />

      <div className="pay-settings-save">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          <i className={`fas ${saving ? 'fa-circle-notch fa-spin' : 'fa-save'}`} /> ذخیره تنظیمات پرداخت
        </button>
      </div>
    </div>
  );
}

export default function PaymentsTab() {
  const { toast } = useToast();
  const [sub, setSub] = useState('list');
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load(page = 1) {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    Object.entries(filters).forEach(([k, v]) => { if (String(v).trim()) params.set(k, String(v).trim()); });
    const res = await api(`/api/admin/payments?${params}`);
    setLoading(false);
    if (!res.success) return toast(res.message || 'دریافت پرداخت‌ها ناموفق بود', 'error');
    setRows(res.data || []);
    setSummary(res.summary || {});
    setPagination(res.pagination || { page, totalPages: 1, total: 0 });
    setChecked(new Set());
  }

  useEffect(() => {
    if (sub !== 'list') return undefined;
    const timer = setTimeout(() => load(1), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sub]);

  async function review(approve) {
    if (!selected) return;
    if (!approve && !reviewNote.trim()) return toast('علت رد را بنویسید تا به کاربر نمایش داده شود', 'error');
    setBusy(true);
    const res = await api(`/api/admin/payments/${encodeURIComponent(selected._id)}/${approve ? 'approve' : 'reject'}`, {
      method: 'POST',
      body: JSON.stringify({ note: reviewNote }),
    });
    setBusy(false);
    if (!res.success) return toast(res.message || 'عملیات ناموفق بود', 'error');
    toast(res.message, 'success');
    setSelected(res.data);
    setReviewNote('');
    load(pagination.page);
  }

  async function runDelete({ ids, all }) {
    const count = all ? pagination.total : ids.length;
    if (!count) return;
    const ok = await confirmAction({
      title: all
        ? `حذف همه ${faDigits(count)} صورتحساب${hasFilters ? ' مطابق فیلتر فعلی' : ''}؟`
        : `حذف ${faDigits(count)} صورتحساب پرداخت؟`,
      text: 'سابقه پرداخت و تصویر رسیدها برای همیشه حذف می‌شود و قابل بازگشت نیست (مگر از پشتیبان). سفارش‌ها حذف نمی‌شوند.',
      confirmText: 'حذف',
      icon: 'warning',
    });
    if (!ok) return;
    setDeleting(true);
    const res = ids?.length === 1 && !all
      ? await api(`/api/admin/payments/${encodeURIComponent(ids[0])}`, { method: 'DELETE' })
      : await api('/api/admin/payments/bulk-delete', {
        method: 'POST',
        body: JSON.stringify(all ? { all: true, filters } : { ids }),
      });
    setDeleting(false);
    if (!res.success) return toast(res.message || 'حذف ناموفق بود', 'error');
    toast(res.message || 'حذف شد', 'success');
    if (selected && (all || ids.includes(selected._id))) setSelected(null);
    load(rows.length === count && pagination.page > 1 ? pagination.page - 1 : pagination.page);
  }

  function toggleRow(id) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const update = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const hasFilters = Object.values(filters).some((v) => String(v).trim());
  const allOnPageChecked = rows.length > 0 && rows.every((r) => checked.has(r._id));

  return (
    <section id="tab-payments" className="tab-pane active">
      <SectionHeader title="پرداخت‌ها" sub="تایید رسید کارت به کارت، تراکنش‌های بله و درگاه، و تنظیم روش‌های پرداخت" />
      <div className="sub-tabs">
        <button type="button" className={`sub-tab-btn${sub === 'list' ? ' active' : ''}`} onClick={() => setSub('list')}><i className="fas fa-list" /> تراکنش‌ها</button>
        <button type="button" className={`sub-tab-btn${sub === 'settings' ? ' active' : ''}`} onClick={() => setSub('settings')}><i className="fas fa-sliders" /> تنظیمات پرداخت</button>
      </div>

      {sub === 'settings' && <PaymentSettings />}

      {sub === 'list' && (
        <div className="card">
          <div className="report-grid finance-summary-grid has-split-cards">
            <div className="mini-card"><div className="stat-label">جمع پرداخت‌شده</div><div className="stat-value">{money(summary.paidAmount || 0)}</div></div>
            <div className="mini-card"><div className="stat-label">تعداد پرداخت موفق</div><div className="stat-value">{faDigits(summary.paidCount || 0)}</div></div>
            <div className="mini-card"><div className="stat-label">در انتظار تایید</div><div className="stat-value">{faDigits(summary.reviewCount || 0)}</div></div>
            <div className="mini-card"><div className="stat-label">مبلغ در انتظار تایید</div><div className="stat-value">{money(summary.reviewAmount || 0)}</div></div>
          </div>

          <div className="pay-filter-bar">
            <label className="pay-filter-field">
              <span>وضعیت</span>
              <select className="form-control" value={filters.status} onChange={(e) => update('status', e.target.value)}>
                <option value="">همه وضعیت‌ها</option>
                {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="pay-filter-field">
              <span>روش</span>
              <select className="form-control" value={filters.method} onChange={(e) => update('method', e.target.value)}>
                <option value="">همه روش‌ها</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="pay-filter-field">
              <span>بابت</span>
              <select className="form-control" value={filters.scope} onChange={(e) => update('scope', e.target.value)}>
                <option value="">همه موارد</option>
                {Object.entries(PAYMENT_SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="pay-filter-field pay-filter-field--search">
              <span>جستجو</span>
              <div className="pay-filter-search">
                <i className="fas fa-magnifying-glass" aria-hidden="true" />
                <input className="form-control" placeholder="نام، شماره پرداخت، کد پیگیری…" value={filters.q} onChange={(e) => update('q', e.target.value)} />
              </div>
            </label>
            {hasFilters && (
              <button type="button" className="btn btn-outline btn-sm pay-filter-clear" onClick={() => setFilters(FILTER_DEFAULTS)}>
                <i className="fas fa-filter-circle-xmark" /> پاک‌سازی
              </button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="pay-bulk-bar">
              <span className="pay-bulk-count">
                {checked.size ? `${faDigits(checked.size)} مورد انتخاب شده` : `${faDigits(pagination.total)} صورتحساب`}
              </span>
              <div className="pay-bulk-actions">
                <button type="button" className="btn btn-outline btn-sm pay-reject-btn" disabled={!checked.size || deleting} onClick={() => runDelete({ ids: [...checked] })}>
                  <i className="fas fa-trash-can" /> حذف انتخاب‌شده‌ها
                </button>
                <button type="button" className="btn btn-outline btn-sm pay-reject-btn" disabled={deleting} onClick={() => runDelete({ all: true })}>
                  <i className={`fas ${deleting ? 'fa-circle-notch fa-spin' : 'fa-dumpster'}`} /> {hasFilters ? 'حذف همه موارد فیلترشده' : 'حذف همه'}
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap">
            {loading ? <AdminSpinner /> : !rows.length ? (
              <EmptyState icon="fa-wallet" title="پرداختی یافت نشد" desc="پس از فعال‌سازی پرداخت، تراکنش‌های کاربران اینجا نمایش داده می‌شوند." />
            ) : (
              <>
                <table className="table pay-admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label="انتخاب همه موارد این صفحه"
                          checked={allOnPageChecked}
                          onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())}
                        />
                      </th>
                      <th>شماره</th>
                      <th>نام</th>
                      <th>بابت</th>
                      <th>مبلغ</th>
                      <th>روش</th>
                      <th>تاریخ</th>
                      <th>وضعیت</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p._id} className={checked.has(p._id) ? 'is-checked' : ''}>
                        <td><input type="checkbox" aria-label={`انتخاب ${p.code}`} checked={checked.has(p._id)} onChange={() => toggleRow(p._id)} /></td>
                        <td className="statement-number-col">{p.code}</td>
                        <td style={{ fontWeight: 800 }}>
                          {p.payerName || p.payerUsername || '-'}
                          <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{p.payerDepartment || ''}</div>
                        </td>
                        <td>
                          {PAYMENT_SCOPE_LABEL[p.scope]}
                          {p.statementNumber && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{p.statementNumber}</div>}
                        </td>
                        <td>{money(p.amount)}</td>
                        <td>{PAYMENT_PROVIDER_LABEL[p.provider] || p.method}{p.sandbox ? ' (آزمایشی)' : ''}</td>
                        <td>{jdate(p.createdAt)}</td>
                        <td>
                          <span className={`badge badge-${PAYMENT_STATUS_CLASS[p.status] || 'gray'}`}>{p.statusLabel}</span>
                          {p.failureReason && p.status === 'paid' && <div className="pay-warning-hint"><i className="fas fa-triangle-exclamation" /> بررسی شود</div>}
                        </td>
                        <td>
                          <div className="statement-actions">
                            <button type="button" className={`btn btn-sm ${p.status === 'review' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setReviewNote(''); setSelected(p); }}>
                              <i className={`fas ${p.status === 'review' ? 'fa-check-double' : 'fa-eye'}`} /> {p.status === 'review' ? 'بررسی' : 'مشاهده'}
                            </button>
                            <button type="button" className="btn btn-outline btn-sm pay-reject-btn" title="حذف" aria-label={`حذف ${p.code}`} disabled={deleting} onClick={() => runDelete({ ids: [p._id] })}>
                              <i className="fas fa-trash-can" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPage={(pg) => load(pg)} />
              </>
            )}
          </div>
        </div>
      )}

      {selected && (
        <PaymentInvoice
          payment={selected}
          receiptUrl={`/api/admin/payments/${encodeURIComponent(selected._id)}/receipt`}
          onClose={() => setSelected(null)}
        >
          {(selected.status === 'review' || selected.status === 'initiated') && (
            <div className="pay-review-box">
              {selected.payerNote && <p className="pay-invoice-note"><i className="fas fa-comment" /> توضیح کاربر: {selected.payerNote}</p>}
              {selected.status === 'initiated' && (
                <p className="pay-invoice-note"><i className="fas fa-circle-info" /> این تراکنش آنلاین هنوز تایید نشده است. فقط اگر از واریز وجه مطمئن هستید، آن را دستی تایید کنید.</p>
              )}
              <input className="form-control" placeholder="یادداشت مدیر (برای رد الزامی است)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={300} />
              <div className="pay-review-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => review(true)}>
                  <i className="fas fa-check" /> تایید پرداخت
                </button>
                {selected.status === 'review' && (
                  <button type="button" className="btn btn-outline btn-sm pay-reject-btn" disabled={busy} onClick={() => review(false)}>
                    <i className="fas fa-xmark" /> رد پرداخت
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="pay-review-box">
            <button type="button" className="btn btn-outline btn-sm pay-reject-btn" disabled={deleting} onClick={() => runDelete({ ids: [selected._id] })}>
              <i className="fas fa-trash-can" /> حذف این صورتحساب و تصویر رسید
            </button>
          </div>
        </PaymentInvoice>
      )}
    </section>
  );
}
