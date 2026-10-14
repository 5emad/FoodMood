export const PAYMENT_METHOD_LABEL = {
  card: 'کارت به کارت',
  bale: 'بله',
  gateway: 'درگاه بانکی',
  discount: 'کد تخفیف (بدون پرداخت)',
};

export const PAYMENT_METHOD_ICON = {
  card: 'fa-credit-card',
  bale: 'fa-comment-dollar',
  gateway: 'fa-building-columns',
};

export const PAYMENT_PROVIDER_LABEL = {
  card: 'کارت به کارت',
  bale: 'پیام‌رسان بله',
  zarinpal: 'زرین‌پال',
  zibal: 'زیبال',
  discount: 'کد تخفیف',
};

export const PAYMENT_SCOPE_LABEL = {
  cart: 'سبد خرید',
  week: 'صورتحساب هفتگی',
  month: 'صورتحساب ماهیانه',
};

export const PAYMENT_STATUS_LABEL = {
  initiated: 'در انتظار پرداخت',
  review: 'در انتظار تایید مدیر',
  paid: 'پرداخت شده',
  rejected: 'رد شده',
  failed: 'ناموفق',
  cancelled: 'لغو شده',
};

export const PAYMENT_STATUS_CLASS = {
  initiated: 'gray',
  review: 'warning',
  paid: 'success',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'gray',
};

/** وضعیت پرداخت یک صورتحساب */
export const BILL_STATUS_LABEL = {
  paid: 'پرداخت شده',
  partial: 'پرداخت ناقص',
  review: 'در انتظار تایید',
  unpaid: 'پرداخت نشده',
  none: '—',
};

export const BILL_STATUS_CLASS = {
  paid: 'success',
  partial: 'primary',
  review: 'warning',
  unpaid: 'danger',
  none: 'gray',
};

export function formatCardNumber(value) {
  return String(value || '').replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1-');
}
