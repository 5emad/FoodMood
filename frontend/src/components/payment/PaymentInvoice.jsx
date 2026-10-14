import { useEffect, useState } from 'react';
import { faDigits, jdate, money } from '../../utils/format';
import {
  PAYMENT_PROVIDER_LABEL,
  PAYMENT_SCOPE_LABEL,
  PAYMENT_STATUS_CLASS,
  PAYMENT_STATUS_LABEL,
} from '../../lib/payments';

/** فیش/صورتحساب پرداخت — برای کاربر و مدیر؛ تصویر رسید کنار فیش باز می‌شود */
export default function PaymentInvoice({ payment, orgName, onClose, receiptUrl, children }) {
  const [showImage, setShowImage] = useState(false);
  const [imageState, setImageState] = useState('loading');

  useEffect(() => {
    setShowImage(false);
    setImageState('loading');
  }, [payment?._id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (showImage) setShowImage(false);
      else onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showImage, onClose]);

  if (!payment) return null;
  const paid = payment.status === 'paid';
  const canShowImage = !!(receiptUrl && payment.hasReceipt);

  return (
    <div className="receipt-modal-root">
      <div className="receipt-modal-overlay" onClick={onClose} />
      <div
        className={`receipt-modal pay-invoice-modal${showImage ? ' is-split' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="صورتحساب پرداخت"
      >
        <div className="pay-invoice-layout">
          <div className="pay-invoice-col">
            <button type="button" className="receipt-modal-close" onClick={onClose} aria-label="بستن">
              <i className="fas fa-times" />
            </button>
            <div className="receipt-paper pay-invoice">
              <div className="receipt-paper-head">
                <div className="receipt-brand">{orgName || 'سامانه تغذیه'}</div>
                <div className="receipt-kind">{paid ? 'صورتحساب پرداخت‌شده' : 'رسید درخواست پرداخت'}</div>
              </div>
              {paid && <div className="pay-invoice-stamp" aria-hidden="true">پرداخت شد</div>}
              <div className="receipt-dash" />
              <div className="receipt-meta">
                <div className="receipt-meta-row"><span>شماره پرداخت</span><strong className="receipt-id">{payment.code}</strong></div>
                <div className="receipt-meta-row">
                  <span>وضعیت</span>
                  <strong><span className={`badge badge-${PAYMENT_STATUS_CLASS[payment.status] || 'gray'}`}>{payment.statusLabel || PAYMENT_STATUS_LABEL[payment.status]}</span></strong>
                </div>
                <div className="receipt-meta-row"><span>نام</span><strong>{payment.payerName || payment.payerUsername || '—'}</strong></div>
                <div className="receipt-meta-row"><span>بابت</span><strong>{PAYMENT_SCOPE_LABEL[payment.scope] || payment.scope}</strong></div>
                {payment.scope !== 'cart' && payment.periodLabel && (
                  <div className="receipt-meta-row"><span>دوره</span><strong>{payment.periodLabel.replace(/^صورتحساب (هفتگی|ماهیانه) /, '')}</strong></div>
                )}
                {payment.statementNumber && (
                  <div className="receipt-meta-row"><span>شناسه صورتحساب</span><strong>{payment.statementNumber}</strong></div>
                )}
                <div className="receipt-meta-row"><span>روش پرداخت</span><strong>{PAYMENT_PROVIDER_LABEL[payment.provider] || payment.method}</strong></div>
                <div className="receipt-meta-row"><span>تاریخ ثبت</span><strong>{jdate(payment.createdAt)}</strong></div>
                {payment.paidAt && <div className="receipt-meta-row"><span>تاریخ پرداخت</span><strong>{jdate(payment.paidAt)}</strong></div>}
                {payment.referenceId && <div className="receipt-meta-row"><span>کد پیگیری</span><strong dir="ltr">{payment.referenceId}</strong></div>}
                {payment.trackingCode && <div className="receipt-meta-row"><span>کد پیگیری کاربر</span><strong dir="ltr">{payment.trackingCode}</strong></div>}
                {payment.cardPan && <div className="receipt-meta-row"><span>کارت پرداخت‌کننده</span><strong dir="ltr">{payment.cardPan}</strong></div>}
              </div>
              <div className="receipt-dash" />
              <div className="receipt-items-head"><span>اقلام</span><span>مبلغ</span></div>
              <div className="receipt-items">
                {(payment.items || []).map((item) => (
                  <div key={String(item.orderId)} className="receipt-item">
                    <div className="receipt-item-info">
                      <div className="receipt-item-name">{item.foodName || 'سفارش'}</div>
                      <div className="receipt-item-meta-row">
                        <span className="receipt-date-box">{item.jalaliDate || '—'}</span>
                        {item.orderNumber ? <span className="receipt-order-box">#{item.orderNumber}</span> : null}
                      </div>
                    </div>
                    <div className="receipt-item-price">{money(item.amount)}</div>
                  </div>
                ))}
              </div>
              <div className="receipt-dash" />
              <div className="receipt-totals">
                <div className="receipt-total-row"><span>تعداد اقلام</span><strong>{faDigits((payment.items || []).length)}</strong></div>
                <div className="receipt-total-row receipt-total-row--pay">
                  <span>{paid ? 'مبلغ پرداخت‌شده' : 'مبلغ'}</span>
                  <strong>{money(payment.amount)}</strong>
                </div>
              </div>
              {(payment.reviewNote || payment.failureReason) && (
                <p className="pay-invoice-note">
                  <i className="fas fa-circle-info" /> {payment.reviewNote || payment.failureReason}
                </p>
              )}
              {canShowImage && (
                <button
                  type="button"
                  className={`pay-invoice-receipt-link${showImage ? ' is-active' : ''}`}
                  onClick={() => setShowImage((v) => !v)}
                  aria-expanded={showImage}
                >
                  <i className={`fas ${showImage ? 'fa-eye-slash' : 'fa-image'}`} />
                  {showImage ? ' بستن تصویر رسید' : ' مشاهده تصویر رسید بارگذاری‌شده'}
                </button>
              )}
              {children}
              <div className="receipt-dash receipt-dash--dots" />
              <div className="receipt-footer">
                {paid ? 'این صورتحساب پس از تایید پرداخت توسط سامانه صادر شده است.' : 'پس از تایید پرداخت، صورتحساب پرداخت‌شده صادر می‌شود.'}
              </div>
            </div>
          </div>

          {canShowImage && showImage && (
            <aside className="pay-receipt-panel" aria-label="تصویر رسید پرداخت">
              <div className="pay-receipt-panel-head">
                <strong><i className="fas fa-image" /> تصویر رسید</strong>
                <div className="pay-receipt-panel-actions">
                  <a href={receiptUrl} target="_blank" rel="noopener noreferrer" title="باز کردن در اندازه کامل" aria-label="باز کردن در اندازه کامل">
                    <i className="fas fa-up-right-from-square" />
                  </a>
                  <button type="button" onClick={() => setShowImage(false)} title="بستن تصویر" aria-label="بستن تصویر">
                    <i className="fas fa-times" />
                  </button>
                </div>
              </div>
              <div className="pay-receipt-panel-body">
                {imageState === 'loading' && <div className="spinner" />}
                {imageState === 'error' && <p className="pay-receipt-panel-error">بارگذاری تصویر رسید ممکن نشد.</p>}
                <img
                  src={receiptUrl}
                  alt="تصویر رسید پرداخت"
                  onLoad={() => setImageState('ok')}
                  onError={() => setImageState('error')}
                  style={imageState === 'ok' ? undefined : { display: 'none' }}
                />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
