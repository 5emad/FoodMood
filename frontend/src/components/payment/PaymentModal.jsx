import { useEffect, useState } from 'react';
import { api, apiForm } from '../../api/client';
import { useToast } from '../ToastProvider';
import ModalPortal from '../../components/ModalPortal';
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
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [discount, setDiscount] = useState(null);
  const [codeError, setCodeError] = useState('');
  const [checking, setChecking] = useState(false);
  const netAmount = discount ? discount.netAmount : target.amount;
  const coveredByCode = !!discount && discount.netAmount <= 0;

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
      discountCode: discount?.code || '',
    };
  }

  async function applyCode(e) {
    e?.preventDefault();
    const code = codeInput.trim();
    if (!code) return setCodeError('کد تخفیف را وارد کنید');
    setChecking(true);
    setCodeError('');
    try {
      const res = await api('/api/user/payments/discount/check', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload(), discountCode: code }),
      });
      if (!res.success) {
        setDiscount(null);
        setCodeError(res.message || 'کد تخفیف معتبر نیست');
        return;
      }
      setDiscount(res.data);
      toast(res.message || 'کد تخفیف اعمال شد', 'success');
    } catch {
      setCodeError('خطا در اتصال');
    } finally {
      setChecking(false);
    }
  }

  function removeCode() {
    setDiscount(null);
    setCodeInput('');
    setCodeError('');
  }

  async function payWithCode() {
    setBusy(true);
    try {
      const res = await api('/api/user/payments/discount/pay', { method: 'POST', body: JSON.stringify(basePayload()) });
      if (!res.success) return toast(res.message || 'ثبت ناموفق بود', 'error');
      toast(res.message || 'ثبت شد', 'success');
      onDone?.(res.data);
    } catch {
      toast('خطا در اتصال', 'error');
    } finally {
      setBusy(false);
    }
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
    fd.append('discountCode', payload.discountCode);
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
    <ModalPortal>
    <div className="receipt-modal-root">
      <div className="receipt-modal-overlay" onClick={() => !busy && onClose()} />
      <div className="receipt-modal pay-modal" role="dialog" aria-modal="true" aria-label="پرداخت">
        <div className="pay-modal-card">
          <button type="button" className="receipt-modal-close" onClick={onClose} disabled={busy} aria-label="بستن">
            <i className="fas fa-times" />
          </button>
          <div className="pay-modal-head">
            <span className="pay-modal-head-ico"><i className="fas fa-wallet" /></span>
            <div>
              <strong>پرداخت</strong>
              <span>{target.title}</span>
            </div>
          </div>
          <div className="pay-modal-amount">
            <span>مبلغ قابل پرداخت</span>
            <strong>
              {discount && <s className="pay-modal-amount-old">{money(target.amount)}</s>}
              {money(netAmount)}
            </strong>
          </div>

          <div className={`pay-discount${discount ? ' is-applied' : ''}`}>
            {discount ? (
              <div className="pay-discount-applied">
                <i className="fas fa-ticket" />
                <span>
                  کد <b dir="ltr">{discount.code}</b> ({discount.label}) — تخفیف <b>{money(discount.discountAmount)}</b>
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={removeCode} disabled={busy}>حذف</button>
              </div>
            ) : !codeOpen ? (
              <button type="button" className="pay-discount-toggle" onClick={() => setCodeOpen(true)}>
                <i className="fas fa-ticket" /> کد تخفیف دارید؟
              </button>
            ) : (
              <form className="pay-discount-form" onSubmit={applyCode}>
                <input
                  className="form-control"
                  dir="ltr"
                  placeholder="DISCOUNT-CODE"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeError(''); }}
                  maxLength={24}
                  autoComplete="off"
                  spellCheck="false"
                  autoFocus
                  aria-label="کد تخفیف"
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={checking || !codeInput.trim()}>
                  {checking ? <i className="fas fa-circle-notch fa-spin" /> : 'اعمال'}
                </button>
              </form>
            )}
            {codeError && <p className="pay-discount-error" role="alert">{codeError}</p>}
          </div>

          {coveredByCode && (
            <button type="button" className="btn btn-primary btn-w100 pay-online-btn" onClick={payWithCode} disabled={busy}>
              <i className={`fas ${busy ? 'fa-circle-notch fa-spin' : 'fa-ticket'}`} /> ثبت با کد تخفیف (بدون پرداخت)
            </button>
          )}

          {!coveredByCode && <>
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
                    <i className={`${method === m.key ? 'fas fa-circle-dot' : 'far fa-circle'} pay-method-radio`} />
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
            </>}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
