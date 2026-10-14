import { useEffect, useState } from 'react';
import { api, apiForm } from '../../api/client';
import { useToast } from '../ToastProvider';
import { money } from '../../utils/format';
import { PAYMENT_METHOD_ICON, formatCardNumber } from '../../lib/payments';

const METHOD_HINT = {
  card: 'واریز به کارت و بارگذاری تصویر رسید؛ پس از تایید مدیر ثبت می‌شود',
  bale: 'پرداخت از کیف پول یا کارت داخل اپلیکیشن بله',
  gateway: 'انتقال به درگاه امن بانکی و پرداخت با کارت‌های عضو شتاب',
};

/**
 * انتخاب روش پرداخت برای سبد خرید یا صورتحساب.
 * target: { scope, periodKey?, orderIds?, title, amount }
 */
export default function PaymentModal({ target, config, onClose, onDone }) {
  const { toast } = useToast();
  const methods = config?.methods || [];
  const [method, setMethod] = useState(methods.length === 1 ? methods[0].key : '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function basePayload() {
    return {
      scope: target.scope,
      periodKey: target.periodKey || '',
      orderIds: target.orderIds || [],
    };
  }

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(config.card.cardNumber);
      toast('شماره کارت کپی شد', 'success');
    } catch {
      toast('کپی ممکن نشد؛ شماره را دستی وارد کنید', 'error');
    }
  }

  async function submitCard(e) {
    e.preventDefault();
    if (!file) return toast('تصویر رسید پرداخت را انتخاب کنید', 'error');
    const fd = new FormData();
    const payload = basePayload();
    fd.append('scope', payload.scope);
    fd.append('periodKey', payload.periodKey);
    fd.append('orderIds', JSON.stringify(payload.orderIds));
    fd.append('trackingCode', trackingCode);
    fd.append('note', note);
    fd.append('receipt', file);
    setBusy(true);
    try {
      const res = await apiForm('/api/user/payments/card', fd);
      if (!res.success) return toast(res.message || 'ثبت رسید ناموفق بود', 'error');
      toast(res.message || 'رسید ثبت شد', 'success');
      onDone?.(res.data);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function startOnline() {
    setBusy(true);
    try {
      const res = await api('/api/user/payments/online', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload(), method }),
      });
      if (!res.success) {
        toast(res.message || 'اتصال به درگاه ناموفق بود', 'error');
        return;
      }
      const url = res.data?.redirectUrl;
      if (!url) return toast('آدرس پرداخت دریافت نشد', 'error');
      // درگاه: صفحه بانک — بله: پیش‌فاکتور سامانه (دکمه پرداخت در بله یا شبیه‌ساز آزمایشی)
      window.location.assign(url);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="receipt-modal-root">
      <div className="receipt-modal-overlay" onClick={() => !busy && onClose()} />
      <div className="receipt-modal pay-modal" role="dialog" aria-modal="true" aria-label="پرداخت">
        <button type="button" className="receipt-modal-close" onClick={onClose} disabled={busy} aria-label="بستن">
          <i className="fas fa-times" />
        </button>
        <div className="pay-modal-card">
          <div className="pay-modal-head">
            <span className="pay-modal-head-ico"><i className="fas fa-wallet" /></span>
            <div>
              <strong>پرداخت</strong>
              <span>{target.title}</span>
            </div>
          </div>
          <div className="pay-modal-amount">
            <span>مبلغ قابل پرداخت</span>
            <strong>{money(target.amount)}</strong>
          </div>

          <>
              <div className="pay-method-list" role="radiogroup" aria-label="روش پرداخت">
                {methods.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={method === m.key}
                    className={`pay-method${method === m.key ? ' is-active' : ''}`}
                    onClick={() => setMethod(m.key)}
                    disabled={busy}
                  >
                    <span className="pay-method-ico"><i className={`fas ${PAYMENT_METHOD_ICON[m.key] || 'fa-wallet'}`} /></span>
                    <span className="pay-method-copy">
                      <strong>{m.label}</strong>
                      <span>{METHOD_HINT[m.key]}</span>
                    </span>
                    <i className={`fas ${method === m.key ? 'fa-circle-dot' : 'fa-circle'} pay-method-radio`} />
                  </button>
                ))}
                {!methods.length && <p className="pay-modal-empty">روش پرداختی فعال نیست.</p>}
              </div>

              {method === 'card' && config.card && (
                <form className="pay-card-form" onSubmit={submitCard}>
                  <div className="pay-card-box">
                    <div className="pay-card-number" dir="ltr">{formatCardNumber(config.card.cardNumber)}</div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={copyCard}>
                      <i className="fas fa-copy" /> کپی
                    </button>
                    <div className="pay-card-meta">
                      {config.card.cardHolder && <span>به نام: <strong>{config.card.cardHolder}</strong></span>}
                      {config.card.bankName && <span>بانک: <strong>{config.card.bankName}</strong></span>}
                      {config.card.sheba && <span dir="ltr" className="pay-card-sheba">{config.card.sheba}</span>}
                    </div>
                    {config.card.note && <p className="pay-card-note">{config.card.note}</p>}
                  </div>
                  <label className="form-label" htmlFor="payReceipt">تصویر رسید پرداخت <span className="pay-required">*</span></label>
                  <label className={`pay-upload${preview ? ' has-file' : ''}`} htmlFor="payReceipt">
                    {preview
                      ? <img src={preview} alt="پیش‌نمایش رسید" />
                      : <span><i className="fas fa-cloud-arrow-up" /> انتخاب تصویر (JPG، PNG یا WebP — حداکثر ۵ مگابایت)</span>}
                  </label>
                  <input
                    id="payReceipt"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="pay-upload-input"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <label className="form-label" htmlFor="payTracking">کد پیگیری / شماره ارجاع</label>
                  <input id="payTracking" className="form-control" value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} maxLength={64} dir="ltr" />
                  <label className="form-label" htmlFor="payNote">توضیحات (اختیاری)</label>
                  <input id="payNote" className="form-control" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
                  <button type="submit" className="btn btn-primary btn-w100" disabled={busy}>
                    <i className={`fas ${busy ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`} /> ثبت رسید و ارسال برای تایید
                  </button>
                </form>
              )}

              {(method === 'bale' || method === 'gateway') && (
                <button type="button" className="btn btn-primary btn-w100 pay-online-btn" onClick={startOnline} disabled={busy}>
                  <i className={`fas ${busy ? 'fa-circle-notch fa-spin' : PAYMENT_METHOD_ICON[method]}`} />
                  {method === 'bale' ? ' پرداخت با بله' : ' انتقال به درگاه پرداخت'}
                </button>
              )}
            </>
        </div>
      </div>
    </div>
  );
}
