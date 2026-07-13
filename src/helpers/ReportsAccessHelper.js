const Order = require('../models/Order');

async function countPendingOrders() {
  return Order.countDocuments({ status: 'pending' });
}

function buildAccessMessage(pendingCount) {
  if (pendingCount <= 0) return null;
  return `${pendingCount.toLocaleString('fa-IR')} سفارش هنوز تایید نشده است. ابتدا همه سفارش‌ها را در بخش سفارش‌ها تایید کنید.`;
}

async function getReportsAccessForUser(_user) {
  const pendingCount = await countPendingOrders();
  return {
    allowed: pendingCount === 0,
    pendingCount,
    message: buildAccessMessage(pendingCount),
  };
}

async function assertReportsAccess(user) {
  const status = await getReportsAccessForUser(user);
  if (!status.allowed) {
    const error = new Error(status.message);
    error.status = 403;
    throw error;
  }
  return status;
}

module.exports = {
  countPendingOrders,
  getReportsAccessForUser,
  assertReportsAccess,
};
