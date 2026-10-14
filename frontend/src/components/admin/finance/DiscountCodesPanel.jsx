import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import { useJalaliDatepicker } from '../../../hooks/useJalaliDatepicker';
import AdminSpinner from '../shared/AdminSpinner';
import EmptyState from '../shared/EmptyState';
import ModalPortal from '../../ModalPortal';
import { faDigits, jdate, money } from '../../../utils/format';

const EMPTY_FORM = {
  code: '',
  title: '',
  type: 'percent',
  value: '',
  maxDiscount: '',
  audience: 'all',
  departmentId: '',
  personKey: '',
  personLabel: '',
  periodType: 'any',
  periodKey: '',
  expiresAt: '',
  maxUses: '',
  perPersonLimit: '1',
};

const AUDIENCE_LABEL = { all: 'همه', department: 'واحد', person: 'یک نفر' };

function normalizeDigits(value) {
  const map = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  return String(value ?? '').replace(/[۰-۹]/g, (d) => map[d] || d);
}

function monthKey(from) {
  const m = normalizeDigits(from).match(/(\d{4})\D+(\d{1,2})/);
  return m ? `${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : '';
}

function CodeForm({ onClose, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [departments, setDepartments] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [months, setMonths] = useState([]);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  useJalaliDatepicker(true);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    (async () => {
      const [d, w, m, g] = await Promise.all([
        api('/api/admin/departments'),
        api('/api/admin/weeks?noSync=true'),
        api('/api/admin/finance-statements/months'),
        api('/api/admin/discount-codes/generate'),
      ]);
      setDepartments(d.success ? d.data : []);
      setWeeks(w.success ? w.data : []);
      setMonths(m.success ? m.data : []);
      if (g.success) set('code', g.data.code);
    })();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.audience !== 'person' || peopleQuery.trim().length < 2) { setPeople([]); return undefined; }
    const timer = setTimeout(async () => {
      const res = await api(`/api/admin/discount-codes/people?q=${encodeURIComponent(peopleQuery.trim())}`);
      setPeople(res.success ? res.data : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [peopleQuery, form.audience]);

  async function regenerate() {
    const res = await api('/api/admin/discount-codes/generate');
    if (res.success) set('code', res.data.code);
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const res = await api('/api/admin/discount-codes', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        value: Number(normalizeDigits(form.value)),
        maxDiscount: Number(normalizeDigits(form.maxDiscount)) || 0,
        maxUses: Number(normalizeDigits(form.maxUses)) || 0,
        perPersonLimit: Number(normalizeDigits(form.perPersonLimit)) || 0,
        expiresAt: normalizeDigits(form.expiresAt),
      }),
    });
    setSaving(false);
    if (!res.success) return toast(res.message || 'ساخت کد ناموفق بود', 'error');
    toast(res.message, 'success');
    onSaved();
  }

  return (
    <ModalPortal>
    <div className="receipt-modal-root">
      <div className="receipt-modal-overlay" onClick={onClose} />
      <div className="receipt-modal discount-form-modal" role="dialog" aria-modal="true" aria-label="کد تخفیف جدید">
        <form className="guest-access-card discount-form" onSubmit={submit}>
          <button type="button" className="receipt-modal-close" onClick={onClose} aria-label="بستن"><i className="fas fa-times" /></button>
          <div className="guest-access-head">
            <span className="guest-access-head-ico"><i className="fas fa-ticket" /></span>
            <div>
              <strong>کد تخفیف جدید</strong>
              <span>برای سبد خرید و پرداخت صورتحساب‌ها</span>
            </div>
          </div>

          <div className="discount-form-grid">
            <label className="discount-field">
              <span>کد</span>
              <div className="guest-access-link">
                <input className="form-control" dir="ltr" value={form.code} maxLength={24} onChange={(e) => set('code', e.target.value.toUpperCase())} required />
                <button type="button" className="btn btn-outline btn-sm" onClick={regenerate} title="تولید تصادفی"><i className="fas fa-dice" /></button>
              </div>
            </label>
            <label className="discount-field">
              <span>عنوان (اختیاری)</span>
              <input className="form-control" value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً تخفیف مهر" />
            </label>
            <label className="discount-field">
              <span>نوع تخفیف</span>
              <select className="form-control" value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="percent">درصدی</option>
                <option value="fixed">مبلغ ثابت (تومان)</option>
              </select>
            </label>
            <label className="discount-field">
              <span>{form.type === 'percent' ? 'درصد (۱ تا ۱۰۰)' : 'مبلغ (تومان)'}</span>
              <input className="form-control" dir="ltr" inputMode="numeric" value={form.value} onChange={(e) => set('value', e.target.value)} required />
            </label>
            {form.type === 'percent' && (
              <label className="discount-field">
                <span>سقف تخفیف (تومان، اختیاری)</span>
                <input className="form-control" dir="ltr" inputMode="numeric" value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} placeholder="0" />
              </label>
            )}

            <label className="discount-field">
              <span>برای چه کسی؟</span>
              <select className="form-control" value={form.audience} onChange={(e) => set('audience', e.target.value)}>
                <option value="all">همه کاربران و مهمان‌ها</option>
                <option value="department">یک واحد</option>
                <option value="person">یک نفر</option>
              </select>
            </label>
            {form.audience === 'department' && (
              <label className="discount-field">
                <span>واحد</span>
                <select className="form-control" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} required>
                  <option value="">انتخاب واحد…</option>
                  {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </select>
              </label>
            )}
            {form.audience === 'person' && (
              <div className="discount-field discount-field--wide">
                <span>فرد</span>
                {form.personKey ? (
                  <div className="discount-person-picked">
                    <i className="fas fa-user-check" /> {form.personLabel}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => { set('personKey', ''); set('personLabel', ''); }}>تغییر</button>
                  </div>
                ) : (
                  <>
                    <input className="form-control" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="جستجو نام، نام کاربری یا شناسه مهمان…" />
                    {people.length > 0 && (
                      <div className="discount-people">
                        {people.map((p) => (
                          <button key={p.key} type="button" onClick={() => { set('personKey', p.key); set('personLabel', p.label); setPeople([]); }}>
                            <i className={`fas ${p.kind === 'guest' ? 'fa-user-tag' : 'fa-user'}`} /> {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <label className="discount-field">
              <span>برای چه دوره‌ای؟</span>
              <select className="form-control" value={form.periodType} onChange={(e) => { set('periodType', e.target.value); set('periodKey', ''); }}>
                <option value="any">همه دوره‌ها</option>
                <option value="week">یک هفته</option>
                <option value="month">یک ماه</option>
              </select>
            </label>
            {form.periodType === 'week' && (
              <label className="discount-field">
                <span>هفته</span>
                <select className="form-control" value={form.periodKey} onChange={(e) => set('periodKey', e.target.value)} required>
                  <option value="">انتخاب هفته…</option>
                  {weeks.map((w) => <option key={w._id} value={w._id}>{w.jalaliStart} تا {w.jalaliEnd}{w.isActive ? ' (فعال)' : ''}</option>)}
                </select>
              </label>
            )}
            {form.periodType === 'month' && (
              <label className="discount-field">
                <span>ماه</span>
                <select className="form-control" value={form.periodKey} onChange={(e) => set('periodKey', e.target.value)} required>
                  <option value="">انتخاب ماه…</option>
                  {months.map((m) => <option key={m.from} value={monthKey(m.from)}>{m.label}</option>)}
                </select>
              </label>
            )}

            <label className="discount-field">
              <span>تاریخ انقضا</span>
              <input
                className="form-control"
                dir="ltr"
                data-jdp
                data-jdp-only-date
                readOnly
                value={form.expiresAt}
                onChange={(e) => set('expiresAt', e.target.value)}
                onInput={(e) => set('expiresAt', e.target.value)}
                placeholder="1405/08/01"
                required
              />
            </label>
            <label className="discount-field">
              <span>حداکثر دفعات استفاده (۰ = نامحدود)</span>
              <input className="form-control" dir="ltr" inputMode="numeric" value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="0" />
            </label>
            <label className="discount-field">
              <span>دفعات مجاز برای هر نفر (۰ = نامحدود)</span>
              <input className="form-control" dir="ltr" inputMode="numeric" value={form.perPersonLimit} onChange={(e) => set('perPersonLimit', e.target.value)} />
            </label>
          </div>
          <p className="guest-access-meta">
            تخفیف فقط روی سهم شخص و فقط سفارش‌هایی که تاریخ تحویلشان در دوره انتخابی است اعمال می‌شود. کدهای عمومی/واحدی باید حداقل ۶ کاراکتر باشند.
          </p>
          <button type="submit" className="btn btn-primary btn-w100" disabled={saving}>
            <i className={`fas ${saving ? 'fa-circle-notch fa-spin' : 'fa-save'}`} /> ساخت کد تخفیف
          </button>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

export default function DiscountCodesPanel() {
  const { toast } = useToast();
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const res = await api('/api/admin/discount-codes');
    setLoading(false);
    setCodes(res.success ? res.data : []);
  }

  useEffect(() => { load(); }, []);

  async function toggle(c) {
    const res = await api(`/api/admin/discount-codes/${encodeURIComponent(c._id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    if (!res.success) return toast(res.message || 'خطا', 'error');
    toast(res.message, 'success');
    load();
  }

  async function remove(c) {
    if (!(await confirmAction({ title: `حذف کد ${c.code}؟`, text: 'پرداخت‌های قبلی با این کد تغییری نمی‌کنند.', confirmText: 'حذف', icon: 'warning' }))) return;
    const res = await api(`/api/admin/discount-codes/${encodeURIComponent(c._id)}`, { method: 'DELETE' });
    if (!res.success) return toast(res.message || 'خطا', 'error');
    toast(res.message, 'success');
    load();
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code);
      toast('کد کپی شد', 'success');
    } catch {
      toast('کپی ممکن نشد', 'error');
    }
  }

  return (
    <div className="card discount-panel">
      <div className="finance-toolbar">
        <div className="finance-toolbar-title"><i className="fas fa-ticket" /><span>کدهای تخفیف</span></div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          <i className="fas fa-plus" /> کد تخفیف جدید
        </button>
      </div>
      <div className="table-wrap">
        {loading ? <AdminSpinner /> : !codes.length ? (
          <EmptyState icon="fa-ticket" title="کد تخفیفی ساخته نشده است" desc="برای همه، یک واحد یا یک نفر کد تخفیف با تاریخ انقضا بسازید." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>کد</th>
                <th>تخفیف</th>
                <th>مخاطب</th>
                <th>دوره</th>
                <th>انقضا</th>
                <th>استفاده</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c._id}>
                  <td>
                    <button type="button" className="discount-code-pill" onClick={() => copy(c.code)} title="کپی" dir="ltr">{c.code}</button>
                    {c.title && <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{c.title}</div>}
                  </td>
                  <td>
                    {c.type === 'percent' ? `${faDigits(c.value)}٪` : money(c.value)}
                    {c.type === 'percent' && c.maxDiscount > 0 && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>سقف {money(c.maxDiscount)}</div>}
                  </td>
                  <td>
                    {AUDIENCE_LABEL[c.audience]}
                    {(c.departmentName || c.personLabel) && <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{c.departmentName || c.personLabel}</div>}
                  </td>
                  <td>{c.periodLabel || 'همه دوره‌ها'}</td>
                  <td>
                    {jdate(c.expiresAt)}
                    {c.expired && <div><span className="badge badge-gray">منقضی</span></div>}
                  </td>
                  <td>
                    {faDigits(c.uses)}{c.maxUses > 0 ? ` از ${faDigits(c.maxUses)}` : ''}
                    {c.totalDiscount > 0 && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{money(c.totalDiscount)}</div>}
                  </td>
                  <td>
                    <button type="button" className={`badge badge-${c.isActive && !c.expired ? 'success' : 'gray'} discount-toggle`} onClick={() => toggle(c)} title="تغییر وضعیت">
                      {c.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn btn-outline btn-sm pay-reject-btn" onClick={() => remove(c)} title="حذف"><i className="fas fa-trash-can" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showForm && <CodeForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}
