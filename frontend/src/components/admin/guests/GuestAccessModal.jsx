import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import { faDigits } from '../../../utils/format';
import ModalPortal from '../../../components/ModalPortal';

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg || '')}`;
}

function timeFa(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function useCountdown(until) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);
  return left;
}

/** دسترسی مهمان: رمز (برای صفحه عمومی /guest) و لینک ورود مستقیم زمان‌دار + QR */
export default function GuestAccessModal({ guest, onClose, onChanged }) {
  const { toast } = useToast();
  const [info, setInfo] = useState(null);
  const [fresh, setFresh] = useState(null); // لینک تازه ساخته‌شده (فقط همین یک بار)
  const [minutes, setMinutes] = useState(30);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const left = useCountdown(fresh?.magic?.expiresAt);

  async function load() {
    const res = await api(`/api/admin/guests/${encodeURIComponent(guest._id)}/access`);
    if (!res.success) {
      toast(res.message || 'دریافت اطلاعات مهمان ناموفق بود', 'error');
      onClose();
      return;
    }
    setInfo(res.data);
  }

  useEffect(() => {
    load();
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest._id]);

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} کپی شد`, 'success');
    } catch {
      toast('کپی ممکن نشد', 'error');
    }
  }

  function downloadQr() {
    const blob = new Blob([fresh.qrSvg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `guest-${info.guestCode}-login-qr.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function call(url, method, body) {
    setBusy(true);
    const res = await api(url, { method, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.success) toast(res.message || 'عملیات ناموفق بود', 'error');
    return res;
  }

  async function createLink() {
    if (info.magic?.active && !(await confirmAction({
      title: 'ساخت لینک جدید؟',
      text: 'لینک فعال قبلی این مهمان باطل می‌شود.',
      confirmText: 'ساخت لینک جدید',
      icon: 'question',
    }))) return;
    const res = await call(`/api/admin/guests/${encodeURIComponent(guest._id)}/access/link`, 'POST', { minutes });
    if (!res.success) return;
    toast(res.message, 'success');
    setFresh(res.data);
    setInfo(res.data);
    onChanged?.();
  }

  async function revokeLink() {
    const res = await call(`/api/admin/guests/${encodeURIComponent(guest._id)}/access/link`, 'DELETE');
    if (!res.success) return;
    toast(res.message, 'success');
    setFresh(null);
    setInfo(res.data);
    onChanged?.();
  }

  async function logoutAll() {
    if (!(await confirmAction({ title: 'خروج مهمان از همه نشست‌ها؟', confirmText: 'خروج', icon: 'warning' }))) return;
    const res = await call(`/api/admin/guests/${encodeURIComponent(guest._id)}/access/logout`, 'POST');
    if (res.success) toast(res.message, 'success');
  }

  async function savePassword(remove = false) {
    if (!remove && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      return toast('رمز باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد', 'error');
    }
    if (remove && !(await confirmAction({
      title: 'حذف رمز مهمان؟',
      text: 'بدون رمز، مهمان از صفحه عمومی ورود نمی‌تواند وارد شود و فقط با لینک ورود مستقیم وارد می‌شود.',
      confirmText: 'حذف رمز',
      icon: 'warning',
    }))) return;
    const res = await call(`/api/admin/guests/${encodeURIComponent(guest._id)}/password`, 'PUT', { password: remove ? '' : password });
    if (!res.success) return;
    toast(res.message, 'success');
    setPassword('');
    setInfo((i) => ({ ...i, hasPassword: res.data.hasPassword }));
    onChanged?.();
  }

  const magic = info?.magic;
  const freshValid = fresh && left > 0;

  return (
    <ModalPortal>
    <div className="receipt-modal-root">
      <div className="receipt-modal-overlay" onClick={onClose} />
      <div className="receipt-modal guest-access-modal" role="dialog" aria-modal="true" aria-label={`دسترسی ${guest.fullName}`}>
        <div className="guest-access-card">
          <button type="button" className="receipt-modal-close" onClick={onClose} aria-label="بستن">
            <i className="fas fa-times" />
          </button>
          <div className="guest-access-head">
            <span className="guest-access-head-ico"><i className="fas fa-qrcode" /></span>
            <div>
              <strong>دسترسی پرتال مهمان</strong>
              <span>{guest.fullName}</span>
            </div>
          </div>

          {!info ? (
            <div className="guest-access-loading"><div className="spinner" /></div>
          ) : (
            <>
              {!info.active && (
                <p className="pay-sandbox-warning"><i className="fas fa-triangle-exclamation" /> این مهمان غیرفعال یا منقضی است و تا فعال‌سازی نمی‌تواند وارد شود.</p>
              )}

              <section className="guest-access-section">
                <div className="guest-access-section-head">
                  <strong><i className="fas fa-link" /> لینک ورود مستقیم</strong>
                  {magic?.active
                    ? <span className="badge badge-success">فعال تا {timeFa(magic.expiresAt)}</span>
                    : magic?.usedAt
                      ? <span className="badge badge-gray">استفاده شده {timeFa(magic.usedAt)}</span>
                      : <span className="badge badge-gray">لینک فعالی ندارد</span>}
                </div>
                {freshValid ? (
                  <>
                    <div className="guest-access-qr">
                      <img src={svgDataUrl(fresh.qrSvg)} alt={`QR ورود ${guest.fullName}`} width={180} height={180} />
                      <div className="guest-access-code">
                        <span>اعتبار باقی‌مانده</span>
                        <strong dir="ltr">{`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`}</strong>
                        <small>یک‌بارمصرف — با اولین ورود باطل می‌شود</small>
                      </div>
                    </div>
                    <div className="guest-access-link">
                      <input className="form-control" dir="ltr" readOnly value={fresh.link} onFocus={(e) => e.target.select()} />
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(fresh.link, 'لینک')} title="کپی لینک"><i className="fas fa-copy" /></button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={downloadQr} title="دانلود QR"><i className="fas fa-download" /></button>
                    </div>
                    <p className="guest-access-meta"><i className="fas fa-eye-slash" /> این لینک فقط همین حالا نمایش داده می‌شود و ذخیره نمی‌شود؛ برای نمایش دوباره باید لینک جدید بسازید.</p>
                  </>
                ) : (
                  <p className="guest-access-meta">مهمان با باز کردن لینک یا اسکن QR، بدون وارد کردن شناسه و رمز مستقیم وارد پرتال خودش می‌شود. لینک زمان‌دار و یک‌بارمصرف است.</p>
                )}
                <div className="guest-access-actions">
                  <select className="form-control guest-access-duration" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="مدت اعتبار">
                    {(info.durations || [30, 60]).map((m) => <option key={m} value={m}>اعتبار {faDigits(m)} دقیقه</option>)}
                  </select>
                  <button type="button" className="btn btn-primary btn-sm" onClick={createLink} disabled={busy || !info.active}>
                    <i className="fas fa-wand-magic-sparkles" /> {magic?.active ? 'ساخت لینک جدید' : 'ساخت لینک'}
                  </button>
                  {magic?.active && (
                    <button type="button" className="btn btn-outline btn-sm pay-reject-btn" onClick={revokeLink} disabled={busy}>
                      <i className="fas fa-ban" /> ابطال لینک
                    </button>
                  )}
                </div>
              </section>

              <section className="guest-access-section">
                <div className="guest-access-section-head">
                  <strong><i className="fas fa-key" /> ورود با شناسه و رمز</strong>
                  {info.hasPassword
                    ? <span className="badge badge-success"><i className="fas fa-lock" /> رمز دارد</span>
                    : <span className="badge badge-gray"><i className="fas fa-lock-open" /> رمز ندارد</span>}
                </div>
                <div className="guest-access-link">
                  <input className="form-control" dir="ltr" readOnly value={info.loginUrl} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(info.loginUrl, 'آدرس ورود')} title="کپی آدرس"><i className="fas fa-copy" /></button>
                </div>
                <div className="guest-access-codeline">
                  <span>شناسه مهمان:</span>
                  <strong dir="ltr">{info.guestCode}</strong>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(info.guestCode, 'شناسه')}><i className="fas fa-copy" /></button>
                </div>
                <div className="guest-access-link">
                  <input
                    className="form-control ph-rtl"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    placeholder={info.hasPassword ? 'رمز جدید (حداقل ۸ کاراکتر، حرف و عدد)' : 'تعیین رمز (حداقل ۸ کاراکتر، حرف و عدد)'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={128}
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => savePassword(false)} disabled={busy || !password}>
                    <i className="fas fa-save" /> ثبت
                  </button>
                </div>
                <div className="guest-access-actions">
                  {info.hasPassword && (
                    <button type="button" className="btn btn-outline btn-sm pay-reject-btn" onClick={() => savePassword(true)} disabled={busy}>
                      <i className="fas fa-trash-can" /> حذف رمز
                    </button>
                  )}
                  <button type="button" className="btn btn-outline btn-sm" onClick={logoutAll} disabled={busy}>
                    <i className="fas fa-right-from-bracket" /> خروج از همه نشست‌ها
                  </button>
                </div>
                <p className="guest-access-meta">
                  ورود از صفحه عمومی فقط با شناسه + رمز + کد امنیتی ممکن است (۵ تلاش ناموفق = قفل ۳۰ دقیقه‌ای). مهمان بدون رمز فقط با لینک ورود مستقیم وارد می‌شود.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
