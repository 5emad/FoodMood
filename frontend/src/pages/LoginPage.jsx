import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';

const SLIDES = [
  'سامانه توزیع و رزرو غذا',
  'رزرو آنلاین وعده‌های روزانه سازمان',
  'گزارش‌گیری و مدیریت متمرکز تغذیه',
];

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const [config, setConfig] = useState({ organizationName: 'سامانه تغذیه', appVersionFa: '' });
  const [slide, setSlide] = useState(0);
  const [mode, setMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', superToken: '' });

  useEffect(() => {
    api('/api/app/public').then((r) => { if (r.success) setConfig(r.data); });
    const t = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 4500);
    return () => clearInterval(t);
  }, []);

  const alerts = [];
  if (params.get('expired')) alerts.push({ type: 'danger', text: 'نشست شما منقضی شده است. لطفا دوباره وارد شوید.' });
  if (params.get('idle')) alerts.push({ type: 'warning', text: 'به دلیل عدم فعالیت، نشست شما پایان یافت.' });

  function redirectAfterLogin(user) {
    if (user?.mustSetFullName) {
      navigate('/complete-profile');
      return;
    }
    if (user?.role === 'admin' || user?.role === 'superadmin') {
      navigate('/admin/dashboard');
      return;
    }
    navigate('/user/dashboard');
  }

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === '2fa') {
        const res = await api('/api/auth/verify-super-token', {
          method: 'POST',
          body: JSON.stringify({ superToken: form.superToken }),
        });
        if (!res.success && res.message) throw new Error(res.message);
        if (res.user) redirectAfterLogin(res.user);
        else toast('ورود سوپر ادمین انجام شد', 'success');
        navigate('/admin/dashboard');
        return;
      }

      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.username, password: form.password }),
      });

      if (res.tokenRequired) {
        setMode('2fa');
        toast(res.message || 'توکن امنیتی را وارد کنید', 'info');
        return;
      }

      if (!res.success && res.message) throw new Error(res.message);
      if (res.user) redirectAfterLogin(res.user);
      else toast('ورود موفقیت‌آمیز بود', 'success');
    } catch (err) {
      toast(err.message || 'اطلاعات ورود صحیح نیست', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-body">
      <div className="auth-wrap">
        <div className="auth-side auth-side--wine">
          <div className="auth-side-title">{config.organizationName}</div>
          <div className="auth-side-carousel">
            {SLIDES.map((text, i) => (
              <p key={text} className={`auth-side-sub auth-side-slide${i === slide ? ' active' : ''}`}>{text}</p>
            ))}
          </div>
          {config.appVersionFa && <div className="auth-side-version">نسخه {config.appVersionFa}</div>}
        </div>

        <div className="auth-card">
          <div className="auth-card-title">خوش آمدید</div>
          <div className="auth-card-sub">نام کاربری و رمز عبور خود را وارد کنید</div>

          {alerts.map((a) => (
            <div key={a.text} className={`alert alert-${a.type}`}><i className="fas fa-exclamation-triangle" /> {a.text}</div>
          ))}

          <form onSubmit={onSubmit} autoComplete="off">
            <div className="form-group">
              <label className="form-label"><i className="fas fa-user" style={{ color: 'var(--primary)', marginLeft: 6 }} /> نام کاربری</label>
              <input className="form-control" value={form.username} disabled={mode === '2fa'} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label"><i className="fas fa-lock" style={{ color: 'var(--primary)', marginLeft: 6 }} /> کلمه عبور</label>
              <input className="form-control input-secret" type="password" value={form.password} disabled={mode === '2fa'} onChange={(e) => setForm({ ...form, password: e.target.value })} required dir="ltr" />
            </div>
            {mode === '2fa' && (
              <div className="form-group">
                <label className="form-label"><i className="fas fa-shield-halved" style={{ color: 'var(--primary)', marginLeft: 6 }} /> توکن امنیتی سوپر ادمین</label>
                <input className="form-control input-secret" type="password" value={form.superToken} onChange={(e) => setForm({ ...form, superToken: e.target.value })} required dir="ltr" />
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => { setMode(''); setForm({ ...form, superToken: '' }); }}>شروع مجدد ورود</button>
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-w100 mt-2" disabled={loading} style={{ padding: 13 }}>
              <i className={`fas ${mode === '2fa' ? 'fa-shield-halved' : 'fa-sign-in-alt'}`} />
              {loading ? 'لطفاً صبر کنید...' : (mode === '2fa' ? 'تایید توکن امنیتی' : 'ورود به پنل')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
