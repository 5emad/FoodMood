import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import AuthShell from '../components/auth/AuthShell';
import { Captcha, Field, PasswordInput } from '../components/auth/AuthFields';

const EMPTY = { fullName: '', username: '', phone: '', departmentId: '', password: '', confirmPassword: '' };

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (!pw) return null;
  if (score <= 2) return { level: 'weak', label: 'ضعیف' };
  if (score <= 3) return { level: 'medium', label: 'متوسط' };
  return { level: 'strong', label: 'قوی' };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState({ organizationName: '', appVersionFa: '' });
  const [meta, setMeta] = useState(null); // null = loading
  const [form, setForm] = useState(EMPTY);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api('/api/app/public').then((r) => { if (r.success) setConfig(r.data || {}); }).catch(() => {});
    api('/api/auth/register/meta')
      .then((r) => setMeta(r.success ? r.data : { enabled: false, departments: [] }))
      .catch(() => setMeta({ enabled: false, departments: [] }));
  }, []);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => (er[key] ? { ...er, [key]: undefined } : er));
  };

  function validateLocally() {
    const next = {};
    const name = form.fullName.trim();
    if (!/^[؀-ۿ‌\s]+$/.test(name) || name.split(/\s+/).filter(Boolean).length < 2) {
      next.fullName = 'نام و نام خانوادگی را به فارسی وارد کنید';
    }
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/.test(form.username.trim())) {
      next.username = '۳ تا ۳۲ کاراکتر؛ با حرف انگلیسی شروع شود';
    }
    if (meta?.departments?.length && !form.departmentId) next.departmentId = 'واحد سازمانی را انتخاب کنید';
    if (form.password.length < 8 || !/[a-zA-Z]/.test(form.password) || !/\d/.test(form.password)) {
      next.password = 'حداقل ۸ کاراکتر شامل حرف انگلیسی و عدد';
    }
    if (form.password !== form.confirmPassword) next.confirmPassword = 'تکرار رمز عبور یکسان نیست';
    if (!captchaAnswer.trim()) next.captcha = 'کد امنیتی را وارد کنید';
    return next;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const local = validateLocally();
    setErrors(local);
    setAlert(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const res = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          phone: form.phone.trim(),
          departmentId: form.departmentId,
          password: form.password,
          confirmPassword: form.confirmPassword,
          captchaAnswer,
        }),
      });
      if (res.success) {
        setDone(res.username || form.username.trim());
        return;
      }
      if (res.field) setErrors({ [res.field]: res.message });
      else setAlert({ type: 'error', text: res.message || 'ثبت‌نام ناموفق بود.' });
      setCaptchaVersion((v) => v + 1);
    } catch (err) {
      setAlert({ type: 'error', text: err.message || 'ثبت‌نام ناموفق بود.' });
      setCaptchaVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  const version = config.appVersionFa || config.appVersion;
  const strength = passwordStrength(form.password);

  if (meta === null) {
    return (
      <AuthShell title="ثبت‌نام" brand={config.organizationName} version={version}>
        <div className="fm-loading"><i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> در حال بارگذاری…</div>
      </AuthShell>
    );
  }

  if (!meta.enabled) {
    return (
      <AuthShell title="ثبت‌نام" brand={config.organizationName} version={version}>
        <div className="fm-alert fm-alert-info">ثبت‌نام در حال حاضر فعال نیست. برای دریافت حساب با مدیر سامانه تماس بگیرید.</div>
        <Link to="/login" className="fm-btn fm-btn-block">بازگشت به ورود</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="ثبت‌نام انجام شد" brand={config.organizationName} version={version}>
        <div className="fm-alert fm-alert-success">حساب «{done}» با موفقیت ساخته شد. اکنون می‌توانید وارد شوید.</div>
        <button type="button" className="fm-btn fm-btn-block fm-btn-lg" onClick={() => navigate(`/login?registered=${encodeURIComponent(done)}`)}>
          ورود به سامانه
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="ثبت‌نام" brand={config.organizationName} version={version} wide>
      {alert && <div className={`fm-alert fm-alert-${alert.type}`} role="alert">{alert.text}</div>}
      <form className="fm-stack" onSubmit={submit} noValidate>
        <Field label="نام و نام خانوادگی" htmlFor="fm-fullname" error={errors.fullName}>
          <input id="fm-fullname" className={`fm-input${errors.fullName ? ' is-invalid' : ''}`} placeholder="مثلاً سارا محمدی" value={form.fullName} onChange={set('fullName')} maxLength={60} autoComplete="name" required autoFocus />
        </Field>
        <div className="fm-grid-2">
          <Field label="نام کاربری" htmlFor="fm-reg-username" error={errors.username} hint="حروف انگلیسی، عدد، نقطه، - یا _">
            <input id="fm-reg-username" className={`fm-input${errors.username ? ' is-invalid' : ''}`} dir="ltr" value={form.username} onChange={set('username')} maxLength={32} autoComplete="username" autoCapitalize="none" spellCheck="false" required />
          </Field>
          <Field label="شماره همراه (اختیاری)" htmlFor="fm-phone" error={errors.phone}>
            <input id="fm-phone" className={`fm-input${errors.phone ? ' is-invalid' : ''}`} dir="ltr" inputMode="tel" placeholder="09121234567" value={form.phone} onChange={set('phone')} maxLength={16} autoComplete="tel" />
          </Field>
        </div>
        {meta.departments?.length > 0 && (
          <Field label="واحد سازمانی" htmlFor="fm-dept" error={errors.departmentId}>
            <select id="fm-dept" className={`fm-input${errors.departmentId ? ' is-invalid' : ''}`} value={form.departmentId} onChange={set('departmentId')} required>
              <option value="">انتخاب واحد…</option>
              {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}
        <div className="fm-grid-2">
          <Field label="رمز عبور" htmlFor="fm-reg-password" error={errors.password} hint="حداقل ۸ کاراکتر، شامل حرف انگلیسی و عدد">
            <PasswordInput id="fm-reg-password" value={form.password} onChange={set('password')} autoComplete="new-password" maxLength={128} invalid={!!errors.password} required />
            {strength && (
              <span className={`fm-strength fm-strength-${strength.level}`}>
                <span className="fm-strength-bar" /> قدرت رمز: {strength.label}
              </span>
            )}
          </Field>
          <Field label="تکرار رمز عبور" htmlFor="fm-reg-confirm" error={errors.confirmPassword}>
            <PasswordInput id="fm-reg-confirm" value={form.confirmPassword} onChange={set('confirmPassword')} autoComplete="new-password" maxLength={128} invalid={!!errors.confirmPassword} required />
          </Field>
        </div>
        <Captcha value={captchaAnswer} onChange={setCaptchaAnswer} version={captchaVersion} error={errors.captcha} />
        <div className="fm-auth-links">
          <span>حساب دارید؟ <Link to="/login">ورود</Link></span>
        </div>
        <div className="fm-auth-actions">
          <Link to="/login" className="fm-btn fm-btn-outline">بازگشت</Link>
          <button type="submit" className="fm-btn" disabled={busy}>
            {busy ? 'در حال ثبت…' : 'ثبت‌نام'}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
