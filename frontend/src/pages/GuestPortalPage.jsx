import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, resetCsrf, setApiPathRewrite, setUnauthorizedHandler } from '../api/client';
import AuthShell from '../components/auth/AuthShell';
import { Captcha, Field, PasswordInput } from '../components/auth/AuthFields';
import UserDashboardPage from './UserDashboardPage';

/** پرتال مهمان همان صفحه کارکنان است با مسیرهای /api/guest */
function guestPath(url) {
  if (url.startsWith('/api/app/user/bootstrap')) return '/api/guest/bootstrap';
  if (url.startsWith('/api/auth/me')) return '/api/guest/me';
  if (url.startsWith('/api/announcements/active')) return '/api/guest/announcements';
  if (url.startsWith('/api/user/')) return `/api/guest/${url.slice('/api/user/'.length)}`;
  if (url.startsWith('/api/orders')) return `/api/guest/orders${url.slice('/api/orders'.length)}`;
  if (url.startsWith('/api/menu/')) return `/api/guest/menu/${url.slice('/api/menu/'.length)}`;
  return url;
}

function getBootstrap() {
  try {
    return JSON.parse(document.getElementById('app-bootstrap-data')?.textContent || '{}');
  } catch {
    return {};
  }
}

/**
 * /guest          → ورود با شناسه + رمز + کد امنیتی (یا مستقیم پرتال اگر نشست معتبر است)
 * /guest/<token>  → لینک ورود مستقیم یک‌بارمصرف و زمان‌دار
 */
export default function GuestPortalPage() {
  const { token } = useParams();
  const boot = useRef(getBootstrap()).current;
  const consumed = useRef(false);
  const [mode, setMode] = useState('checking'); // checking | login | portal | link-error
  const [orgName, setOrgName] = useState(boot.settings?.organizationName || 'سامانه تغذیه');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(null);
  const [portalKey, setPortalKey] = useState(0);
  const version = boot.version?.appVersionFa || boot.version?.appVersion;

  const showLogin = useCallback((message) => {
    setApiPathRewrite(null);
    setUnauthorizedHandler(null);
    setPassword('');
    setCaptcha('');
    setCaptchaVersion((v) => v + 1);
    if (window.location.pathname !== '/guest') window.history.replaceState(null, '', '/guest');
    setAlert(message || null);
    setMode('login');
  }, []);

  const enterPortal = useCallback(() => {
    // قبل از mount داشبورد: همه درخواست‌ها به /api/guest
    setApiPathRewrite(guestPath);
    setUnauthorizedHandler(() => showLogin({ type: 'warning', text: 'نشست شما منقضی شد؛ دوباره وارد شوید.' }));
    // توکن لینک در نوار آدرس/تاریخچه نماند (پارامترهای بازگشت از پرداخت حفظ می‌شوند)
    if (window.location.pathname !== '/guest') {
      window.history.replaceState(null, '', `/guest${window.location.search}`);
    }
    setPortalKey((k) => k + 1);
    setMode('portal');
  }, [showLogin]);

  useEffect(() => () => {
    setApiPathRewrite(null);
    setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token) {
        if (consumed.current) return; // لینک یک‌بارمصرف است؛ دوباره ارسال نشود
        consumed.current = true;
        const res = await api('/api/guest/magic', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => null);
        if (cancelled) return;
        window.history.replaceState(null, '', '/guest');
        if (res?.success) {
          resetCsrf();
          enterPortal();
        } else {
          setAlert({ type: 'error', text: res?.message || 'لینک ورود معتبر نیست.' });
          setMode('link-error');
        }
        return;
      }
      const res = await api('/api/guest/session').catch(() => null);
      if (cancelled) return;
      if (res?.data?.organizationName) setOrgName(res.data.organizationName);
      if (res?.data?.loggedIn) enterPortal();
      else setMode('login');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim() || !password || !captcha) {
      setAlert({ type: 'error', text: 'شناسه، رمز و کد امنیتی را وارد کنید.' });
      return;
    }
    setBusy(true);
    setAlert(null);
    try {
      const res = await api('/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), password, captcha }),
      });
      if (!res.success) {
        setAlert({ type: 'error', text: res.message || 'ورود ناموفق بود' });
        setPassword('');
        setCaptchaVersion((v) => v + 1); // کد امنیتی یک‌بارمصرف است
        return;
      }
      resetCsrf(); // نشست بازسازی شد
      setPassword('');
      enterPortal();
    } catch {
      setAlert({ type: 'error', text: 'خطا در اتصال' });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/api/guest/logout', { method: 'POST' }).catch(() => {});
    resetCsrf();
    showLogin({ type: 'success', text: 'از پرتال مهمان خارج شدید.' });
  }

  if (mode === 'portal') {
    return <UserDashboardPage key={portalKey} guestMode onLogout={logout} />;
  }

  if (mode === 'checking') {
    return (
      <AuthShell title="پرتال مهمان" brand={orgName} version={version}>
        <div className="fm-loading"><i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> {token ? 'در حال ورود با لینک…' : 'لطفاً صبر کنید…'}</div>
      </AuthShell>
    );
  }

  if (mode === 'link-error') {
    return (
      <AuthShell title="لینک ورود" brand={orgName} version={version}>
        {alert && <div className={`fm-alert fm-alert-${alert.type}`} role="status">{alert.text}</div>}
        <Link to="/guest" className="fm-btn fm-btn-block" onClick={() => showLogin(null)}>
          <i className="fas fa-right-to-bracket" aria-hidden="true" /> ورود با شناسه و رمز
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="ورود مهمان" brand={orgName} version={version}>
      {alert && <div className={`fm-alert fm-alert-${alert.type}`} role="status">{alert.text}</div>}
      <form className="fm-stack" onSubmit={submit} noValidate>
        <Field label="شناسه مهمان" htmlFor="fm-guest-code">
          <input
            id="fm-guest-code"
            className="fm-input"
            placeholder="شناسه مهمان را وارد کنید"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="username"
            dir="ltr"
            maxLength={20}
            required
            autoFocus
          />
        </Field>
        <Field label="رمز" htmlFor="fm-guest-password">
          <PasswordInput
            id="fm-guest-password"
            placeholder="رمز مهمان را وارد کنید"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </Field>
        <Captcha value={captcha} onChange={setCaptcha} version={captchaVersion} endpoint="/api/guest/captcha" />
        <button type="submit" className="fm-btn fm-btn-block fm-btn-lg" disabled={busy}>
          {busy
            ? <><i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> در حال ورود…</>
            : <><i className="fas fa-right-to-bracket" aria-hidden="true" /> ورود به پرتال مهمان</>}
        </button>
        <p className="fm-hint" style={{ textAlign: 'center' }}>
          رمز یا لینک ورود مستقیم را از مسئول سامانه دریافت کنید.
        </p>
      </form>
    </AuthShell>
  );
}
