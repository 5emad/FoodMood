import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';

function initialAlert(params) {
  if (params.get('inactive')) {
    return { type: 'error', text: 'حساب کاربری شما غیرفعال است.' };
  }
  if (params.get('expired')) {
    return { type: 'error', text: 'نشست شما منقضی شده است.' };
  }
  if (params.get('idle')) {
    return { type: 'warning', text: 'به‌دلیل عدم فعالیت، نشست پایان یافت.' };
  }
  return null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const [config, setConfig] = useState({ organizationName: 'سامانه تغذیه', appVersionFa: '' });
  const [step, setStep] = useState('username'); // username | password | 2fa
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resolved, setResolved] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', superToken: '' });
  /** First-time 2FA token — shown masked once; copy only, never plaintext toast */
  const [bootstrapToken, setBootstrapToken] = useState('');

  useEffect(() => {
    const bootEl = document.getElementById('app-bootstrap-data');
    if (bootEl) {
      try {
        const boot = JSON.parse(bootEl.textContent || '{}');
        if (boot?.version?.appVersionFa || boot?.settings?.organizationName) {
          setConfig((c) => ({
            ...c,
            organizationName: boot.settings?.organizationName || c.organizationName,
            ...boot.version,
          }));
        }
      } catch { /* ignore */ }
    }
    api('/api/app/public').then((r) => { if (r.success) setConfig((c) => ({ ...c, ...r.data })); });
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
      } catch {
        /* stay on login */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const boot = initialAlert(params);
    if (boot) toast(boot.text, boot.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redirectAfterLogin(user) {
    if (user?.mustSetFullName) {
      navigate('/complete-profile');
      return;
    }
    if (user?.role === 'admin' || user?.role === 'superadmin') {
      navigate('/admin/reports');
      return;
    }
    navigate('/user/dashboard');
  }

  function resetToUsername() {
    setStep('username');
    setResolved(null);
    setForm((f) => ({ ...f, password: '', superToken: '' }));
    setShowPassword(false);
    setBootstrapToken('');
  }

  async function copyBootstrapToken() {
    if (!bootstrapToken) return;
    try {
      await navigator.clipboard.writeText(bootstrapToken);
      toast('توکن کپی شد — در جای امن ذخیره کنید.', 'success');
    } catch {
      toast('کپی نشد؛ با Ctrl+A و Ctrl+C از فیلد مخفی کپی کنید.', 'warning');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (step === '2fa') {
      if (!form.superToken.trim()) {
        toast('توکن امنیتی را وارد کنید.', 'error');
        return;
      }
      setLoading(true);
      try {
        const res = await api('/api/auth/verify-super-token', {
          method: 'POST',
          body: JSON.stringify({ token: form.superToken.trim() }),
        });
        if (!res.success) {
          toast(res.message || 'توکن امنیتی نامعتبر است.', 'error');
          return;
        }
        setBootstrapToken('');
        if (res.user) redirectAfterLogin(res.user);
        else navigate('/admin/reports');
      } catch (err) {
        toast(err.message || 'توکن امنیتی نامعتبر است.', 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (step === 'username') {
      const username = form.username.trim();
      if (!username) {
        toast('نام کاربری را وارد کنید.', 'error');
        return;
      }
      setLoading(true);
      try {
        const res = await api('/api/auth/resolve-username', {
          method: 'POST',
          body: JSON.stringify({ username }),
        });
        const nextUser = res?.username || username;
        setResolved({ username: nextUser });
        setForm((f) => ({ ...f, username: nextUser, password: '' }));
        setShowPassword(false);
        setStep('password');
      } catch {
        // حتی در خطا هم به رمز می‌رویم تا وجود کاربر لو نرود
        setResolved({ username });
        setForm((f) => ({ ...f, username, password: '' }));
        setShowPassword(false);
        setStep('password');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!form.password) {
      toast('رمز عبور را وارد کنید.', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.username, password: form.password }),
      });

      if (res.tokenRequired) {
        setShowPassword(false);
        setForm((f) => ({ ...f, superToken: '' }));
        setStep('2fa');
        if (res.secondFactorToken) {
          setBootstrapToken(String(res.secondFactorToken));
          toast('توکن امنیتی جدید صادر شد — مخفی است؛ فقط کپی و ذخیره کنید.', 'warning');
        } else {
          setBootstrapToken('');
          toast(res.message || 'توکن امنیتی را وارد کنید.', 'info');
        }
        return;
      }

      if (!res.success) {
        toast(res.message || 'اطلاعات وارد شده صحیح نیست.', 'error');
        return;
      }

      if (res.user) redirectAfterLogin(res.user);
      else navigate('/user/dashboard');
    } catch (err) {
      toast(err.message || 'ورود ناموفق بود. اتصال یا پایگاه داده را بررسی کنید.', 'error');
    } finally {
      setLoading(false);
    }
  }

  const brand = config.organizationName || 'سامانه تغذیه';

  return (
    <div className="auth-body auth-body--minimal">
      <div className="auth-login-shell">
        <div className="auth-login-brand">
          <div className="auth-login-mark" aria-hidden="true">
            <i className="fas fa-utensils" />
          </div>
          <h1 className="auth-login-title">{brand}</h1>
        </div>

        <form className="auth-login-card" onSubmit={onSubmit} autoComplete="off" noValidate>
          {step === 'username' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="login-username">نام کاربری</label>
                <input
                  id="login-username"
                  className="form-control"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="نام کاربری"
                  autoCapitalize="none"
                  spellCheck="false"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary btn-w100 auth-login-submit" disabled={loading}>
                {loading ? 'بررسی...' : 'ادامه'}
              </button>
            </>
          )}

          {step === 'password' && (
            <>
              <div className="auth-user-chip">
                <i className="fas fa-user" />
                <span>{resolved?.username || form.username}</span>
                <button type="button" className="auth-user-chip-change" onClick={resetToUsername}>تغییر</button>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">رمز عبور</label>
                <div className="auth-password-wrap">
                  <input
                    id="login-password"
                    className="form-control input-secret"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="رمز عبور"
                    dir="ltr"
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'مخفی کردن رمز' : 'نمایش رمز'}
                  >
                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-w100 auth-login-submit" disabled={loading}>
                {loading ? 'در حال ورود...' : 'ورود'}
              </button>
            </>
          )}

          {step === '2fa' && (
            <>
              {bootstrapToken ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="login-bootstrap-token">توکن جدید (فقط یک‌بار — مخفی)</label>
                  <div className="auth-password-wrap">
                    <input
                      id="login-bootstrap-token"
                      className="form-control input-secret"
                      type="password"
                      readOnly
                      value={bootstrapToken}
                      dir="ltr"
                      autoComplete="off"
                      aria-label="توکن جدید مخفی"
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={copyBootstrapToken}
                      aria-label="کپی توکن"
                      title="کپی"
                    >
                      <i className="fas fa-copy" />
                    </button>
                  </div>
                  <p className="form-hint" style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    روی صفحه دیده نمی‌شود؛ کپی کنید و در جای امن نگه دارید.
                  </p>
                </div>
              ) : null}
              <div className="form-group">
                <label className="form-label" htmlFor="login-token">توکن امنیتی</label>
                <input
                  id="login-token"
                  className="form-control input-secret"
                  type="password"
                  autoComplete="off"
                  spellCheck="false"
                  value={form.superToken}
                  onChange={(e) => setForm({ ...form, superToken: e.target.value })}
                  dir="ltr"
                  placeholder="توکن"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary btn-w100 auth-login-submit" disabled={loading}>
                {loading ? 'بررسی...' : 'تایید'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-w100"
                style={{ marginTop: 10 }}
                onClick={resetToUsername}
              >
                بازگشت
              </button>
            </>
          )}
        </form>

        <div className="auth-login-version">
          نسخه {config.appVersionFa || config.appVersion || '—'}
        </div>
      </div>
    </div>
  );
}
