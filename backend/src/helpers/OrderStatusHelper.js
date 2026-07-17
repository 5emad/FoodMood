const Order = require('../models/Order');
const Counter = require('../models/Counter');

const CANCEL_WINDOW_MINUTES = 30;

function getCancelDeadline(order) {
  return new Date(new Date(order.orderDate || order.createdAt).getTime() + CANCEL_WINDOW_MINUTES * 60 * 1000);
}

function isCancelable(order) {
  return order.status === 'pending' && Date.now() <= getCancelDeadline(order).getTime();
}

async function finalizeExpiredOrders(filter = {}) {
  const threshold = new Date(Date.now() - CANCEL_WINDOW_MINUTES * 60 * 1000);
  return Order.updateMany(
    {
      ...filter,
      status: 'pending',
      orderDate: { $lte: threshold },
    },
    { $set: { status: 'confirmed' } }
  );
}

function decorateOrder(order) {
  const raw = typeof order.toObject === 'function' ? order.toObject() : order;
  const cancelDeadline = getCancelDeadline(raw);
  const deliveryDate = raw.menuItemId?.dailyMenuId?.date || null;
  return {
    ...raw,
    cancelDeadline,
    canCancel: raw.status === 'pending' && Date.now() <= cancelDeadline.getTime(),
    deliveryDate,
  };
}

async function ensureOrderNumbers() {
  const maxOrder = await Order.findOne({ orderNumber: { $exists: true, $ne: null } })
    .sort({ orderNumber: -1 })
    .select('orderNumber')
    .lean();

  let nextNumber = Math.max(99, Number(maxOrder?.orderNumber || 99));
  const missingOrders = await Order.find({
    $or: [
      { orderNumber: { $exists: false } },
      { orderNumber: null },
    ],
  })
    .sort({ orderDate: 1, createdAt: 1, _id: 1 })
    .select('_id')
    .lean();

  for (const order of missingOrders) {
    nextNumber += 1;
    await Order.updateOne({ _id: order._id }, { $set: { orderNumber: nextNumber } });
  }

  const counter = await Counter.findById('orderNumber').lean();
  const counterValue = Math.max(Number(counter?.seq || 99), nextNumber);
  await Counter.updateOne(
    { _id: 'orderNumber' },
    { $set: { seq: counterValue } },
    { upsert: true }
  );
}

module.exports = {
  CANCEL_WINDOW_MINUTES,
  getCancelDeadline,
  isCancelable,
  finalizeExpiredOrders,
  ensureOrderNumbers,
  decorateOrder,
};
