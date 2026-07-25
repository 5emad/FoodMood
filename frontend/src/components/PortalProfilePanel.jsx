import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from './ToastProvider';

function initialsFromName(name, username) {
  const raw = String(name || username || '').trim();
  if (!raw) return '؟';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
  return raw.slice(0, 2);
}

export default function PortalProfilePanel({ open, user, onClose, onUserUpdate }) {
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(user?.fullName || '');
    setPhone(user?.phone || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [open, user?.fullName, user?.phone, user?.id]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    document.body.classList.add('portal-profile-modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('portal-profile-modal-open');
    };
  }, [open, onClose]);

  if (!open) return null;

  async function saveProfile(e) {
    if (e) e.preventDefault();
    if (savingProfile) return;
    if (!String(fullName || '').trim()) {
      toast('لطفاً نام و نام خانوادگی را وارد کنید', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      const data = await api('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: fullName.trim(), phone }),
      });
      if (!data || data.success === false || (data.message && !data.success)) {
        toast(data?.message || 'ذخیره پروفایل ناموفق بود', 'error');
        return;
      }
      toast(data.message || 'تغییرات ذخیره شد', 'success');
      if (data.user && onUserUpdate) onUserUpdate(data.user);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e) {
    if (e) e.preventDefault();
    if (savingPassword) return;
    if (!currentPassword) {
      toast('لطفاً رمز عبور فعلی را وارد کنید', 'error');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      toast('رمز جدید باید حداقل ۸ کاراکتر باشد', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('رمز جدید با تکرار آن مطابقت ندارد', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const data = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          oldPassword: currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      if (!data || data.success === false || (data.message && !data.success)) {
        toast(data?.message || 'تغییر رمز ناموفق بود', 'error');
        return;
      }
      toast(data.message || 'رمز عبور به‌روز شد', 'success');
      setTimeout(() => {
        window.location.replace('/login?passwordChanged=1');
      }, 700);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  const dept = user?.department?.name || user?.department || '—';
  const firstName = user?.fullName ? user.fullName.split(/\s+/)[0] : '';

  return (
    <div className="portal-profile-modal-root" role="presentation">
      <div className="portal-profile-modal-overlay" onClick={(e) => { e.stopPropagation(); onClose?.(); }} />
      <div
        className="portal-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-label="تنظیمات حساب"
      >
        <button
          type="button"
          className="portal-profile-modal-close"
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          aria-label="بستن"
        >
          <i className="fas fa-times" />
        </button>

        <div className="portal-profile portal-profile--modal">
          <header className="portal-profile-hero">
            <div className="portal-profile-avatar" aria-hidden="true">
              {initialsFromName(user?.fullName, user?.username)}
            </div>
            <div className="portal-profile-hero-copy">
              <p className="portal-profile-eyebrow">حساب کاربری</p>
              <h2 className="portal-profile-title">سلام{firstName ? `، ${firstName}` : ''}</h2>
            </div>
          </header>

          <div className="portal-profile-grid">
            <form className="portal-profile-card" onSubmit={saveProfile}>
              <div className="portal-profile-card-head">
                <span className="portal-profile-card-ico" aria-hidden="true"><i className="fas fa-id-card" /></span>
                <div>
                  <h3 className="portal-profile-card-title">اطلاعات شخصی</h3>
                </div>
              </div>

              <label className="portal-field">
                <span>نام کاربری</span>
                <input type="text" value={user?.username || ''} disabled readOnly />
              </label>
              <label className="portal-field">
                <span>نام و نام خانوادگی</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className="portal-field">
                <span>شماره تماس</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="۰۹۱۲xxxxxxx"
                  autoComplete="tel"
                />
              </label>
              <label className="portal-field">
                <span>واحد سازمانی</span>
                <input type="text" value={dept} disabled readOnly />
              </label>
              <button
                type="submit"
                onClick={saveProfile}
                className="btn btn-primary portal-profile-submit"
                disabled={savingProfile}
              >
                {savingProfile ? 'در حال ذخیره...' : 'ذخیره اطلاعات'}
              </button>
            </form>

            <form className="portal-profile-card portal-profile-card--secure" onSubmit={savePassword}>
              <div className="portal-profile-card-head">
                <span className="portal-profile-card-ico" aria-hidden="true"><i className="fas fa-key" /></span>
                <div>
                  <h3 className="portal-profile-card-title">تغییر رمز عبور</h3>
                </div>
              </div>

              <label className="portal-field">
                <span>رمز فعلی</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </label>
              <label className="portal-field">
                <span>رمز جدید</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </label>
              <label className="portal-field">
                <span>تکرار رمز جدید</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </label>
              <button
                type="submit"
                onClick={savePassword}
                className="btn btn-primary portal-profile-submit"
                disabled={savingPassword}
              >
                {savingPassword ? 'در حال ثبت...' : 'به‌روزرسانی رمز'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
