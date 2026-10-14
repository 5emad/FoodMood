const Payment = require('../models/Payment');
const Order = require('../models/Order');

/** سفارشی که پرداخت تاییدشده یا رسید در انتظار بررسی دارد، فقط با حذف هفته لغو می‌شود */
const LOCKING_STATUSES = ['paid', 'review'];

const PAID_ORDER_LOCK_MESSAGE = 'این سفارش پرداخت شده (یا رسید آن در انتظار بررسی است) و قابل لغو نیست؛ فقط با حذف کل هفته لغو می‌شود';

/** Map<orderId, 'paid'|'review'> */
async function paymentLockMap(orderIds = []) {
  const ids = orderIds.filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;
  const payments = await Payment.find({ status: { $in: LOCKING_STATUSES }, 'items.orderId': { $in: ids } })
    .select('status items.orderId')
    .lean();
  const wanted = new Set(ids.map(String));
  for (const payment of payments) {
    for (const item of payment.items || []) {
      const key = String(item.orderId);
      if (!wanted.has(key)) continue;
      if (map.get(key) !== 'paid') map.set(key, payment.status);
    }
  }
  return map;
}

async function isOrderPaymentLocked(orderId) {
  return (await paymentLockMap([orderId])).size > 0;
}

/** تعداد سفارش‌های فعالِ پرداخت‌شده روی این آیتم‌های منو (برای تغییر/حذف غذا) */
async function countLockedOrdersForMenuItems(menuItemIds = []) {
  const ids = menuItemIds.filter(Boolean);
  if (!ids.length) return 0;
  const orders = await Order.find({ menuItemId: { $in: ids }, status: { $ne: 'cancelled' } }).select('_id').lean();
  return (await paymentLockMap(orders.map((o) => o._id))).size;
}

/** فیلد paymentLock به سفارش‌ها اضافه می‌کند و امکان لغو را برای پرداخت‌شده‌ها می‌بندد */
async function attachPaymentLocks(orders = []) {
  const plain = orders.map((o) => (o && typeof o.toObject === 'function' ? o.toObject() : o));
  const locks = await paymentLockMap(plain.map((o) => o?._id));
  return plain.map((o) => {
    const lock = locks.get(String(o?._id)) || null;
    return lock ? { ...o, paymentLock: lock, canCancel: false } : { ...o, paymentLock: null };
  });
}

module.exports = {
  PAID_ORDER_LOCK_MESSAGE,
  paymentLockMap,
  isOrderPaymentLocked,
  countLockedOrdersForMenuItems,
  attachPaymentLocks,
};
