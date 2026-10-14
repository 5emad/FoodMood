import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, resetCsrf } from '../api/client';
import { useToast } from '../components/ToastProvider';
import AuthShell from '../components/auth/AuthShell';
import { Captcha, Field, PasswordInput } from '../components/auth/AuthFields';

function initialAlert(params) {
  if (params.get('inactive')) return { type: 'error', text: 'حساب کاربری شما غیرفعال است.' };
  if (params.get('expired')) return { type: 'warning', text: 'نشست شما منقضی شده است؛ دوباره وارد شوید.' };
  if (params.get('idle')) return { type: 'warning', text: 'به‌دلیل عدم فعالیت، نشست پایان یافت.' };
  if (params.get('registered')) return { type: 'success', text: 'حساب شما ساخته شد؛ اکنون وارد شوید.' };
  return null;
}

function readBootstrap() {
  try {
    const el = document.getElementById('app-bootstrap-data');
    return el ? JSON.parse(el.textContent || '{}') : {};
  } catch {
    return {};
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const boot = readBootstrap();
  const [config, setConfig] = useState(() => ({
    organizationName: boot.settings?.organizationName || 'سامانه تغذیه',
    allowLocalRegistration: Boolean(boot.settings?.allowLocalRegistration),
    ...(boot.version || {}),
  }));
  const [step, setStep] = useState('login'); // login | 2fa
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(params.get('registered') || '');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [superToken, setSuperToken] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [alert, setAlert] = useState(() => initialAlert(params));
  const [fieldError, setFieldError] = useState(null); // { field, message }

  useEffect(() => {
    api('/api/app/public').then((r) => {
      if (r.success) setConfig((c) => ({ ...c, ...r.data }));
    }).catch(() => {});
  }, []);

  // Already authenticated → leave /login
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api('/api/auth/me');
        if (cancelled || !me?.success) return;
        const user = me.user || me.data?.user || me.data;
        if (user) redirectAfterLogin(user);
      } catch { /* stay on login */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redirectAfterLogin(user) {
    if (user?.mustSetFullName) return navigate('/complete-profile');
    if (user?.role === 'admin' || user?.role === 'superadmin') return navigate('/admin/reports');
    return navigate('/user/dashboard');
  }

  function backToLogin() {
    setStep('login');
    setPassword('');
    setSuperToken('');
    setBootstrapToken('');
    setFieldError(null);
    setAlert(null);
    setCaptchaVersion((v) => v + 1);
  }

  async function copyBootstrapToken() {
    try {
      await navigator.clipboard.writeText(bootstrapToken);
      toast('توکن کپی شد — در جای امن ذخیره کنید.', 'success');
    } catch {
      toast('کپی نشد؛ دوباره تلاش کنید.', 'warning');
    }
  }

  const loginReady = username.trim() && password && captchaAnswer.trim();

  async function submitLogin(e) {
    e.preventDefault();
    if (busy) return;
    setFieldError(null);
    if (!loginReady) {
      setAlert({ type: 'error', text: 'نام کاربری، رمز عبور و کد امنیتی را وارد کنید.' });
      return;
    }
    setBusy(true);
    setAlert(null);
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password, captchaAnswer }),
      });
      if (res.tokenRequired) {
        setStep('2fa');
        setPassword('');
        if (res.secondFactorToken) {
          setBootstrapToken(String(res.secondFactorToken));
          setAlert({ type: 'warning', text: 'توکن امنیتی جدید صادر شد. آن را کپی و در جای امن ذخیره کنید.' });
        } else {
          setAlert({ type: 'info', text: res.message || 'توکن امنیتی سوپر ادمین را وارد کنید.' });
        }
        return;
      }
      if (!res.success) {
        if (res.field === 'captcha') setFieldError({ field: 'captcha', message: res.message });
        else setAlert({ type: 'error', text: res.message || 'اطلاعات وارد شده صحیح نیست.' });
        setCaptchaVersion((v) => v + 1);
        return;
      }
      resetCsrf();
      if (res.user) redirectAfterLogin(res.user);
      else navigate('/user/dashboard');
    } catch (err) {
      setAlert({ type: 'error', text: err.message || 'ورود ناموفق بود. اتصال را بررسی کنید.' });
      setCaptchaVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  async function submitToken(e) {
    e.preventDefault();
    if (busy) return;
    if (!superToken.trim()) {
      setFieldError({ field: 'token', message: 'توکن امنیتی را وارد کنید.' });
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      const res = await api('/api/auth/verify-super-token', {
        method: 'POST',
        body: JSON.stringify({ token: superToken.trim() }),
      });
      if (!res.success) {
        setFieldError({ field: 'token', message: res.message || 'توکن امنیتی نامعتبر است.' });
        if (res._httpStatus === 401 && /منقضی/.test(res.message || '')) backToLogin();
        return;
      }
      setBootstrapToken('');
      resetCsrf();
      if (res.user) redirectAfterLogin(res.user);
      else navigate('/admin/reports');
    } catch (err) {
      setFieldError({ field: 'token', message: err.message || 'توکن امنیتی نامعتبر است.' });
    } finally {
      setBusy(false);
    }
  }

  const version = config.appVersionFa || config.appVersion;

  return (
    <AuthShell title={step === '2fa' ? 'تایید هویت سوپر ادمین' : 'ورود به سامانه'} brand={config.organizationName} version={version}>
      {alert && <div className={`fm-alert fm-alert-${alert.type}`} role="status">{alert.text}</div>}

      {step === 'login' ? (
        <form className="fm-stack" onSubmit={submitLogin} noValidate>
          <Field label="نام کاربری" htmlFor="fm-username">
            <input
              id="fm-username"
              className="fm-input"
              placeholder="نام کاربری خود را وارد کنید"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              dir="ltr"
              maxLength={128}
              required
              autoFocus
            />
          </Field>
          <Field label="رمز عبور" htmlFor="fm-password">
            <PasswordInput
              id="fm-password"
              placeholder="رمز عبور خود را وارد کنید"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </Field>
          <Captcha
            value={captchaAnswer}
            onChange={setCaptchaAnswer}
            version={captchaVersion}
            error={fieldError?.field === 'captcha' ? fieldError.message : undefined}
          />
          {config.allowLocalRegistration && (
            <div className="fm-auth-links">
              <span>حساب کاربری ندارید؟ <Link to="/register">ثبت‌نام</Link></span>
            </div>
          )}
          <button type="submit" className="fm-btn fm-btn-block fm-btn-lg" disabled={busy || !loginReady}>
            {busy ? <><i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> در حال ورود…</> : <><i className="fas fa-right-to-bracket" aria-hidden="true" /> ورود</>}
          </button>
        </form>
      ) : (
        <form className="fm-stack" onSubmit={submitToken} noValidate>
          {bootstrapToken && (
            <Field label="توکن جدید (فقط یک‌بار نمایش داده می‌شود)" htmlFor="fm-bootstrap-token" hint="روی صفحه نمایش داده نمی‌شود؛ کپی کنید و در جای امن نگه دارید.">
              <div className="fm-input-group">
                <input id="fm-bootstrap-token" className="fm-input" type="password" readOnly value={bootstrapToken} dir="ltr" autoComplete="off" />
                <button type="button" className="fm-adornment" onClick={copyBootstrapToken} aria-label="کپی توکن" title="کپی توکن">
                  <i className="fas fa-copy" aria-hidden="true" />
                </button>
              </div>
            </Field>
          )}
          <Field label="توکن امنیتی" htmlFor="fm-token" error={fieldError?.field === 'token' ? fieldError.message : undefined}>
            <PasswordInput
              id="fm-token"
              placeholder="توکن امنیتی سوپر ادمین"
              value={superToken}
              onChange={(e) => setSuperToken(e.target.value)}
              autoComplete="one-time-code"
              maxLength={160}
              invalid={fieldError?.field === 'token'}
              autoFocus
            />
          </Field>
          <div className="fm-auth-actions">
            <button type="button" className="fm-btn fm-btn-outline" onClick={backToLogin} disabled={busy}>بازگشت</button>
            <button type="submit" className="fm-btn" disabled={busy || !superToken.trim()}>
              {busy ? 'در حال بررسی…' : 'تایید'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
