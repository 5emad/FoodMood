const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');

function capacityError(message = 'ظرفیت این غذا تکمیل شده است') {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function duplicateDayError(message = 'برای این روز قبلاً غذا رزرو شده است') {
  const error = new Error(message);
  error.status = 409;
  error.code = 11000;
  return error;
}

async function sumActiveQuantity(menuItemId) {
  const rows = await Order.aggregate([
    { $match: { menuItemId, status: { $ne: 'cancelled' } } },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  return Number(rows[0]?.total || 0);
}

/** همگام‌سازی شمارنده ظرفیت از روی سفارش‌های واقعی */
async function syncMenuItemReservedCount(menuItemId) {
  if (!menuItemId) return 0;
  const total = await sumActiveQuantity(menuItemId);
  await MenuItem.updateOne({ _id: menuItemId }, { $set: { reservedCount: total, updatedAt: new Date() } });
  return total;
}

async function syncAllMenuItemReservedCounts() {
  const ids = await MenuItem.find().select('_id').lean();
  for (const row of ids) {
    await syncMenuItemReservedCount(row._id);
  }
}

/**
 * رزرو اتمیک ظرفیت روی MenuItem.reservedCount
 * capacity<=0 یعنی بدون سقف (فقط شمارنده را افزایش می‌دهد)
 */
async function claimCapacity(menuItemId, quantity = 1, capacity = 0) {
  const qty = Math.max(1, Number(quantity) || 1);
  if (capacity > 0) {
    const updated = await MenuItem.findOneAndUpdate(
      {
        _id: menuItemId,
        reservedCount: { $lte: capacity - qty },
      },
      { $inc: { reservedCount: qty }, $set: { updatedAt: new Date() } },
      { new: true },
    );
    if (!updated) {
      // ممکن است شمارنده قدیمی باشد — یک‌بار sync و retry
      await syncMenuItemReservedCount(menuItemId);
      const retry = await MenuItem.findOneAndUpdate(
        {
          _id: menuItemId,
          reservedCount: { $lte: capacity - qty },
        },
        { $inc: { reservedCount: qty }, $set: { updatedAt: new Date() } },
        { new: true },
      );
      if (!retry) throw capacityError();
      return retry;
    }
    return updated;
  }

  return MenuItem.findByIdAndUpdate(
    menuItemId,
    { $inc: { reservedCount: qty }, $set: { updatedAt: new Date() } },
    { new: true },
  );
}

async function releaseCapacity(menuItemId, quantity = 1) {
  if (!menuItemId) return;
  const qty = Math.max(1, Number(quantity) || 1);
  await MenuItem.updateOne(
    { _id: menuItemId, reservedCount: { $gte: qty } },
    { $inc: { reservedCount: -qty }, $set: { updatedAt: new Date() } },
  );
}

async function releaseCapacityForOrder(order) {
  if (!order?.menuItemId || order.status === 'cancelled') return;
  await releaseCapacity(order.menuItemId, order.quantity || 1);
}

function isDuplicateKeyError(err) {
  return Number(err?.code) === 11000 || /duplicate key/i.test(String(err?.message || ''));
}

module.exports = {
  sumActiveQuantity,
  syncMenuItemReservedCount,
  syncAllMenuItemReservedCounts,
  claimCapacity,
  releaseCapacity,
  releaseCapacityForOrder,
  capacityError,
  duplicateDayError,
  isDuplicateKeyError,
};
