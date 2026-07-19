import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiForm } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import PortalSlidesPanel from './PortalSlidesPanel';
import { applyAppFont, refreshThemeVars } from '../../../lib/appFont';

const FONT_OPTIONS = [
  { id: 'vazirmatn', label: 'وزیرمتن' },
  { id: 'yekanbakh', label: 'یکان‌بخ' },
];

const THEME_PRESETS = [
  { id: 'purple', label: 'تم بنفش', themePrimary: '#9B6DFF', themePrimaryLight: '#C4A8FF', themePrimaryDark: '#6C3FD4', themeGradientFrom: '#1A0E38', themeGradientTo: '#2D1460' },
  { id: 'blue', label: 'تم آبی', themePrimary: '#3B82F6', themePrimaryLight: '#93C5FD', themePrimaryDark: '#2563EB', themeGradientFrom: '#1D4ED8', themeGradientTo: '#3B82F6' },
  { id: 'classic', label: 'تم کلاسیک', themePrimary: '#1E3A5F', themePrimaryLight: '#C9A227', themePrimaryDark: '#0F1F33', themeGradientFrom: '#0B1726', themeGradientTo: '#1E3A5F' },
  { id: 'green', label: 'تم سبز', themePrimary: '#10B981', themePrimaryLight: '#6EE7B7', themePrimaryDark: '#047857', themeGradientFrom: '#063F31', themeGradientTo: '#0F766E' },
  { id: 'orange', label: 'تم نارنجی', themePrimary: '#F97316', themePrimaryLight: '#FDBA74', themePrimaryDark: '#C2410C', themeGradientFrom: '#431407', themeGradientTo: '#9A3412' },
  { id: 'red', label: 'تم قرمز', themePrimary: '#8E2A3F', themePrimaryLight: '#C96F82', themePrimaryDark: '#5C1526', themeGradientFrom: '#2A070F', themeGradientTo: '#6E1F31' },
  { id: 'yellow', label: 'تم زرد', themePrimary: '#EAB308', themePrimaryLight: '#FDE047', themePrimaryDark: '#A16207', themeGradientFrom: '#422006', themeGradientTo: '#854D0E' },
];

const DEBOUNCE_MS = 700;

function currentThemeId(form) {
  const norm = (v) => String(v || '').toLowerCase();
  const match = THEME_PRESETS.find((p) => ['themePrimary', 'themePrimaryLight', 'themePrimaryDark', 'themeGradientFrom', 'themeGradientTo']
    .every((k) => norm(form[k]) === norm(p[k])));
  return match?.id || '';
}

const GENERAL_SAVE_KEYS = [
  'organizationName',
  'publicUrl',
  'maxActiveReservations',
  'defaultMenuItemCapacity',
  'showPricesToUsers',
  'uiFont',
  'themePrimary',
  'themePrimaryLight',
  'themePrimaryDark',
  'themeGradientFrom',
  'themeGradientTo',
];

const LDAP_SAVE_KEYS = [
  'ldapEnabled',
  'ldapUrl',
  'ldapSecurity',
  'ldapBaseDn',
  'ldapBindDn',
  'ldapUserFilter',
];

function buildSaveBody(form, extras = {}) {
  const body = {};
  for (const key of GENERAL_SAVE_KEYS) {
    if (form[key] !== undefined) body[key] = form[key];
  }

  if (extras.includeLdap) {
    for (const key of LDAP_SAVE_KEYS) {
      if (form[key] !== undefined) body[key] = form[key];
    }
  }

  if (extras.includePortalSlider && form.portalSlider) {
    body.portalSlider = {
      weekHeroImage: form.portalSlider.weekHeroImage || '',
      weekHeroEnabled: form.portalSlider.weekHeroEnabled === true,
      showAnnouncementSlides: form.portalSlider.showAnnouncementSlides === true,
      showMenuFoodSlides: form.portalSlider.showMenuFoodSlides === true,
      showcaseSlides: (form.portalSlider.showcaseSlides || []).map((slide) => ({
        title: slide?.title || '',
        description: slide?.description || '',
        imageUrl: slide?.imageUrl || '',
        tags: Array.isArray(slide?.tags) ? slide.tags : [],
        badge: slide?.badge || 'اسلاید',
        enabled: slide?.enabled === true,
      })),
    };
  }

  if (extras.ldapBindPassword) body.ldapBindPassword = extras.ldapBindPassword;
  else if (extras.includeLdap && form.ldapBindPassword) body.ldapBindPassword = form.ldapBindPassword;
  if (extras.ldapCaCertPem) body.ldapCaCertPem = extras.ldapCaCertPem;
  if (extras.ldapClearCaCert) body.ldapClearCaCert = true;

  return body;
}

export default function SuperSettingsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const [ssl, setSsl] = useState({});
  const [ldapTesting, setLdapTesting] = useState(false);
  const [ldapBadge, setLdapBadge] = useState('gray');
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [certFiles, setCertFiles] = useState({ certificate: null, privateKey: null });
  const [sslUploading, setSslUploading] = useState(false);

  const readyRef = useRef(false);
  const formRef = useRef(form);
  const debounceRef = useRef(null);
  const saveSeqRef = useRef(0);

  useEffect(() => { formRef.current = form; }, [form]);

  async function loadAll() {
    readyRef.current = false;
    const [s, sslRes] = await Promise.all([
      api('/api/admin/settings'),
      api('/api/admin/settings/ssl-status'),
    ]);
    if (s.success) {
      setForm(s.data || {});
      applyAppFont(s.data?.uiFont);
      refreshThemeVars();
    }
    if (sslRes.success) setSsl(sslRes.data || {});
    setLoading(false);
    // یک تیک بعد از لود، auto-save را فعال کن
    setTimeout(() => { readyRef.current = true; }, 0);
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const activeTheme = useMemo(() => currentThemeId(form), [form]);

  function refreshThemeCss() {
    refreshThemeVars();
  }

  async function persistNow(nextForm, extras = {}) {
    if (!readyRef.current) return false;
    const seq = ++saveSeqRef.current;
    setSaveStatus('saving');
    try {
      const body = buildSaveBody(nextForm, extras);
      const data = await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) });
      if (seq !== saveSeqRef.current) return false;
      if (!data.success) {
        setSaveStatus('error');
        toast(data.message || 'خطا در ذخیره خودکار', 'error');
        return false;
      }
      const saved = { ...(data.data || nextForm), ldapBindPassword: '' };
      applyAppFont(saved.uiFont);
      setForm((prev) => ({ ...prev, ...saved }));
      formRef.current = { ...formRef.current, ...saved };
      setSaveStatus('saved');
      refreshThemeCss();
      return true;
    } catch (err) {
      if (seq === saveSeqRef.current) {
        setSaveStatus('error');
        toast(err?.message || 'خطا در ذخیره خودکار', 'error');
      }
      return false;
    }
  }

  function updateFields(partial, { immediate = false } = {}) {
    const includeLdap = Object.keys(partial).some((k) => k.startsWith('ldap'));
    setForm((prev) => {
      const next = { ...prev, ...partial };
      formRef.current = next;
      const extras = includeLdap ? { includeLdap: true } : {};
      if (immediate) persistNow(next, extras);
      else {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSaveStatus('saving');
        debounceRef.current = setTimeout(() => {
          persistNow(next, extras);
        }, DEBOUNCE_MS);
      }
      return next;
    });
  }

  function selectTheme(preset) {
    const { id, label, ...colors } = preset;
    updateFields(colors, { immediate: true });
  }

  async function testLdap() {
    setLdapTesting(true);
    setLdapBadge('gray');
    const current = formRef.current;
    const body = {
      ldapEnabled: current.ldapEnabled,
      ldapUrl: current.ldapUrl,
      ldapSecurity: current.ldapSecurity,
      ldapBaseDn: current.ldapBaseDn,
      ldapBindDn: current.ldapBindDn,
      ldapBindPassword: current.ldapBindPassword,
      ldapUserFilter: current.ldapUserFilter,
    };
    const data = await api('/api/admin/settings/test-ldap', { method: 'POST', body: JSON.stringify(body) });
    setLdapTesting(false);
    setLdapBadge(data.success ? 'success' : 'danger');
    toast(data.message || (data.success ? 'اتصال موفق' : 'خطا'), data.success ? 'success' : 'error');
    if (data.success && current.ldapBindPassword) {
      await persistNow(current, { includeLdap: true, ldapBindPassword: current.ldapBindPassword });
    }
  }

  async function handleClearCa() {
    if (!(await confirmAction({ title: 'حذف گواهی LDAP؟', text: 'گواهی بلافاصله حذف می‌شود.', confirmText: 'حذف', icon: 'warning' }))) return;
    await persistNow(formRef.current, { includeLdap: true, ldapClearCaCert: true });
  }

  async function handleCaFile(file) {
    if (!file) return;
    try {
      const pem = await file.text();
      await persistNow(formRef.current, { includeLdap: true, ldapCaCertPem: pem });
      toast('گواهی CA ذخیره شد', 'success');
    } catch {
      toast('خواندن فایل گواهی ناموفق بود', 'error');
    }
  }

  async function uploadSsl(files = certFiles) {
    if (!files.certificate || !files.privateKey) return;
    setSslUploading(true);
    const fd = new FormData();
    fd.append('certificate', files.certificate);
    fd.append('privateKey', files.privateKey);
    const data = await apiForm('/api/admin/settings/ssl-certificate', fd);
    setSslUploading(false);
    if (data.success) {
      toast('گواهی SSL نصب شد', 'success');
      setCertFiles({ certificate: null, privateKey: null });
      const r = await api('/api/admin/settings/ssl-status');
      if (r.success) setSsl(r.data);
    } else toast(data.message || 'خطا', 'error');
  }

  function onSslFileChange(which, file) {
    setCertFiles((prev) => {
      const next = { ...prev, [which]: file || null };
      if (next.certificate && next.privateKey) {
        setTimeout(() => uploadSsl(next), 0);
      }
      return next;
    });
  }

  const caStatus = form.hasLdapCaCert ? 'گواهی ذخیره شده' : 'گواهی ثبت نشده';
  const caBadgeClass = form.hasLdapCaCert ? 'badge-success' : 'badge-gray';
  const saveBadge = saveStatus === 'saving'
    ? { cls: 'badge-gray', text: 'در حال ذخیره...' }
    : saveStatus === 'saved'
      ? { cls: 'badge-success', text: 'ذخیره شد' }
      : saveStatus === 'error'
        ? { cls: 'badge-danger', text: 'خطا در ذخیره' }
        : null;

  if (loading) return <AdminSpinner />;

  return (
    <section id="system-settings-page" className="super-page-section">
      <SectionHeader
        title="تنظیمات سامانه"
        sub="تغییرات به‌صورت خودکار ذخیره می‌شوند"
        actions={saveBadge ? <span className={`badge ${saveBadge.cls}`}>{saveBadge.text}</span> : null}
      />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="card-title">تنظیمات عمومی</div>
          {saveBadge && <span className={`badge ${saveBadge.cls}`}>{saveBadge.text}</span>}
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">نام سازمان</label>
              <input className="form-control" value={form.organizationName || ''} onChange={(e) => updateFields({ organizationName: e.target.value })} placeholder="مثال: شرکت فرازمان" />
            </div>
            <div className="form-group">
              <label className="form-label">آدرس عمومی سامانه (دامنه)</label>
              <input className="form-control" dir="ltr" style={{ textAlign: 'left' }} value={form.publicUrl || ''} onChange={(e) => updateFields({ publicUrl: e.target.value })} placeholder="https://food.example.com" />
            </div>
            <div className="form-group">
              <label className="form-label">حداکثر رزرو فعال هر کاربر</label>
              <input className="form-control" type="number" min={0} dir="ltr" style={{ textAlign: 'right' }} value={form.maxActiveReservations ?? ''} onChange={(e) => updateFields({ maxActiveReservations: e.target.value })} placeholder="0 = بدون محدودیت" />
            </div>
            <div className="form-group">
              <label className="form-label">ظرفیت پیش‌فرض هر غذا در هر روز</label>
              <input className="form-control" type="number" min={0} dir="ltr" style={{ textAlign: 'right' }} value={form.defaultMenuItemCapacity ?? ''} onChange={(e) => updateFields({ defaultMenuItemCapacity: e.target.value })} placeholder="مثلا 50" />
            </div>
            <div className="form-group">
              <label className="form-label">نمایش قیمت برای کاربران</label>
              <select className="form-control" value={String(form.showPricesToUsers !== false)} onChange={(e) => updateFields({ showPricesToUsers: e.target.value === 'true' }, { immediate: true })}>
                <option value="true">فعال</option>
                <option value="false">غیرفعال</option>
              </select>
            </div>
            <div className="form-group theme-picker" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">فونت سامانه</label>
              <div className="theme-options" role="radiogroup" aria-label="فونت سامانه">
                {FONT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`theme-option${(form.uiFont || 'vazirmatn') === opt.id ? ' active' : ''}`}
                    onClick={() => {
                      applyAppFont(opt.id);
                      updateFields({ uiFont: opt.id }, { immediate: true });
                    }}
                  >
                    <span style={{ fontFamily: opt.id === 'yekanbakh' ? "'Yekan Bakh FaNum', Tahoma, sans-serif" : "'Vazirmatn', Tahoma, sans-serif", fontWeight: 700 }}>
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group theme-picker">
              <label className="form-label">رنگ‌بندی سامانه</label>
              <div className="theme-options" role="radiogroup" aria-label="رنگ‌بندی سامانه">
                {THEME_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" className={`theme-option${activeTheme === preset.id ? ' active' : ''}`} onClick={() => selectTheme(preset)}>
                    <span className="theme-swatch" style={{ background: `linear-gradient(135deg,${preset.themeGradientFrom},${preset.themePrimary})` }} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
              <div className="theme-color-fields">
                <input type="color" value={form.themePrimary || '#9B6DFF'} onChange={(e) => updateFields({ themePrimary: e.target.value }, { immediate: true })} />
                <input type="color" value={form.themePrimaryLight || '#C4A8FF'} onChange={(e) => updateFields({ themePrimaryLight: e.target.value }, { immediate: true })} />
                <input type="color" value={form.themePrimaryDark || '#6C3FD4'} onChange={(e) => updateFields({ themePrimaryDark: e.target.value }, { immediate: true })} />
                <input type="color" value={form.themeGradientFrom || '#1A0E38'} onChange={(e) => updateFields({ themeGradientFrom: e.target.value }, { immediate: true })} />
                <input type="color" value={form.themeGradientTo || '#2D1460'} onChange={(e) => updateFields({ themeGradientTo: e.target.value }, { immediate: true })} />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 18, borderRadius: 10 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title">تنظیمات LDAP / Active Directory</div>
              <div className="d-flex gap-2 align-center">
                <span className={`badge badge-${ldapBadge}`} style={{ fontSize: '.75rem' }}>
                  <i className={`fas ${ldapTesting ? 'fa-circle-notch fa-spin' : ldapBadge === 'success' ? 'fa-check-circle' : 'fa-circle'}`} style={{ fontSize: ldapTesting ? undefined : '.45rem', verticalAlign: 'middle' }} />
                  {' '}{ldapTesting ? 'در حال بررسی...' : ldapBadge === 'success' ? 'متصل' : ldapBadge === 'danger' ? 'قطع' : 'وضعیت نامشخص'}
                </span>
                <button type="button" className="btn btn-outline btn-sm no-print" disabled={ldapTesting} onClick={testLdap}>
                  <i className="fas fa-plug" /> تست اتصال
                </button>
              </div>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">وضعیت LDAP</label>
                  <select className="form-control" value={String(form.ldapEnabled === true)} onChange={(e) => updateFields({ ldapEnabled: e.target.value === 'true' }, { immediate: true })}>
                    <option value="false">غیرفعال</option>
                    <option value="true">فعال</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">LDAP URL</label>
                  <input className="form-control" dir="ltr" style={{ textAlign: 'left' }} value={form.ldapUrl || ''} onChange={(e) => updateFields({ ldapUrl: e.target.value })} placeholder="ldaps://dc.company.local:636" />
                </div>
                <div className="form-group">
                  <label className="form-label">نوع اتصال</label>
                  <select className="form-control" value={form.ldapSecurity || 'ldaps'} onChange={(e) => updateFields({ ldapSecurity: e.target.value }, { immediate: true })}>
                    <option value="ldaps">LDAPS — پورت ۶۳۶ (پیشنهادی)</option>
                    <option value="starttls">StartTLS — پورت ۳۸۹ + ارتقاء TLS</option>
                    <option value="ldap">LDAP — پورت ۳۸۹ (بدون TLS)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">گواهی CA</label>
                  <input className="form-control" type="file" accept=".pem,.crt,.cer" dir="ltr" onChange={(e) => handleCaFile(e.target.files?.[0] || null)} />
                  <div className="d-flex gap-2 align-center" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${caBadgeClass}`}>{caStatus}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={handleClearCa}>حذف گواهی</button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Base DN</label>
                  <input className="form-control" dir="ltr" style={{ textAlign: 'left' }} value={form.ldapBaseDn || ''} onChange={(e) => updateFields({ ldapBaseDn: e.target.value })} placeholder="DC=company,DC=local" />
                </div>
                <div className="form-group">
                  <label className="form-label">Bind DN</label>
                  <input className="form-control" dir="ltr" style={{ textAlign: 'left' }} value={form.ldapBindDn || ''} onChange={(e) => updateFields({ ldapBindDn: e.target.value })} placeholder="CN=service,CN=Users,DC=company,DC=local" />
                </div>
                <div className="form-group">
                  <label className="form-label">رمز Bind</label>
                  <input
                    className="form-control"
                    type="password"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    value={form.ldapBindPassword || ''}
                    onChange={(e) => updateFields({ ldapBindPassword: e.target.value })}
                    placeholder="رمز اکانت سرویس AD"
                    autoComplete="new-password"
                  />
                  <span className={`badge ${form.hasLdapBindPassword ? 'badge-success' : 'badge-gray'}`} style={{ marginTop: 8, display: 'inline-flex' }}>
                    {form.hasLdapBindPassword ? 'رمز ذخیره شده' : 'رمز ذخیره نشده'}
                  </span>
                </div>
                <div className="form-group">
                  <label className="form-label">User Filter</label>
                  <input className="form-control" dir="ltr" style={{ textAlign: 'left' }} value={form.ldapUserFilter || '(sAMAccountName={{username}})'} onChange={(e) => updateFields({ ldapUserFilter: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          <PortalSlidesPanel
            slider={form.portalSlider}
            onChange={(portalSlider) => {
              setForm((f) => {
                const next = { ...f, portalSlider };
                formRef.current = next;
                return next;
              });
            }}
            onSaveStatus={setSaveStatus}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title">گواهی SSL (HTTPS)</div>
          <span className={`badge ${ssl.customCertificate ? 'badge-success' : ssl.trustTls ? 'badge-warning' : 'badge-gray'}`} style={{ fontSize: '.75rem' }}>
            <i className={`fas ${ssl.customCertificate ? 'fa-lock' : ssl.trustTls ? 'fa-lock-open' : 'fa-globe'}`} />
            {' '}{ssl.customCertificate ? 'گواهی نصب شده' : ssl.trustTls ? 'HTTPS (Not Secure)' : 'HTTP فعال'}
          </span>
        </div>
        <div className="card-body">
          {ssl.hint && <p className="form-hint" style={{ marginBottom: 14, fontSize: '.82rem', color: 'var(--text-muted)' }}>{ssl.hint}</p>}
          <p className="form-hint" style={{ marginBottom: 14, fontSize: '.82rem', color: 'var(--text-muted)' }}>
            با انتخاب هر دو فایل، گواهی به‌صورت خودکار نصب می‌شود.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">فایل گواهی (PEM / CRT)</label>
              <input className="form-control" type="file" accept=".crt,.pem,.cer" onChange={(e) => onSslFileChange('certificate', e.target.files?.[0] || null)} />
            </div>
            <div className="form-group">
              <label className="form-label">کلید خصوصی (KEY / PEM)</label>
              <input className="form-control" type="file" accept=".key,.pem" onChange={(e) => onSslFileChange('privateKey', e.target.files?.[0] || null)} />
            </div>
          </div>
          {sslUploading && (
            <div style={{ marginTop: 12 }}>
              <span className="badge badge-gray"><i className="fas fa-circle-notch fa-spin" /> در حال نصب گواهی...</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
