const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const LdapProfile = require('../models/LdapProfile');
const { buildOrderFromMenuItem } = require('../controllers/OrderController');
const { buildOrderOwnerFilter } = require('../helpers/AuthUserHelper');
const { escapeRegex } = require('../helpers/SecurityHelper');
const { isAutoConfirmMode } = require('../helpers/PaymentConfigHelper');
const { attachPaymentLocks } = require('../helpers/PaymentLockHelper');
const { getSettingsLean } = require('./SettingsService');
const { writeSystemLog } = require('./SystemLogService');
const {
  releaseCapacity,
  isDuplicateKeyError,
  duplicateDayError,
} = require('../helpers/ReservationHelper');

const DUPLICATE_MESSAGE = 'این کاربر برای این وعده در این روز قبلاً غذا رزرو کرده است';
const CART_MODE_MESSAGE = 'با فعال بودن پرداخت سبد خرید، کاربر باید خودش رزرو و پرداخت کند؛ رزرو دستی مدیر در این حالت غیرفعال است';

/**
 * پروفایل AD با حروف کوچک ذخیره می‌شود ولی سفارش‌های خود کاربر با sAMAccountName (ممکن است با حروف بزرگ) ثبت می‌شوند؛
 * همان املای سفارش‌های قبلی را به کار ببر تا رزرو مدیر در پرتال کاربر و بررسی تکرار دیده شود.
 */
async function ldapOrderUsername(profileUsername) {
  const previous = await Order.findOne({ ldapUsername: { $regex: `^${escapeRegex(profileUsername)}$`, $options: 'i' } })
    .sort({ orderDate: -1 })
    .select('ldapUsername')
    .lean();
  return previous?.ldapUsername || profileUsername;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** رزرو دستی مدیر فقط وقتی سبد خرید (پرداخت بلافاصله پس از رزرو) فعال نیست */
async function manualReserveStatus() {
  const settings = await getSettingsLean();
  const cartMode = isAutoConfirmMode(settings);
  return { enabled: !cartMode, reason: cartMode ? CART_MODE_MESSAGE : '' };
}

async function assertManualReserveEnabled() {
  const status = await manualReserveStatus();
  if (!status.enabled) throw httpError(409, status.reason);
}

/**
 * کاربر هدف از شناسه فهرست کاربران مدیر: «ldap:<username>» یا ObjectId کاربر محلی.
 * خروجی: { owner (برای فیلتر سفارش‌ها), actor (برای ساخت سفارش), display }
 */
async function resolveTargetUser(rawId, requester = {}) {
  const id = String(rawId || '').trim();
  let local = null;
  let profile = null;

  if (id.startsWith('ldap:')) {
    const username = id.slice(5).trim().toLowerCase();
    if (!username) throw httpError(404, 'کاربر یافت نشد');
    profile = await LdapProfile.findOne({ ldapUsername: username }).populate('departmentId', 'name').lean();
    if (!profile) throw httpError(404, 'کاربر یافت نشد');
    // کاربر AD که به حساب محلی تبدیل شده، از این پس با حساب محلی سفارش می‌دهد
    if (profile.convertedToLocal) {
      local = await User.findOne({ username: profile.ldapUsername }).populate('departmentId', 'name').lean();
      if (!local) throw httpError(404, 'حساب محلی این کاربر یافت نشد');
      profile = null;
    }
  } else if (mongoose.isValidObjectId(id)) {
    local = await User.findById(id).populate('departmentId', 'name').lean();
    if (!local) throw httpError(404, 'کاربر یافت نشد');
  } else {
    throw httpError(404, 'کاربر یافت نشد');
  }

  if (profile) {
    if (profile.status === 'inactive') throw httpError(400, 'این کاربر غیرفعال است');
    const department = profile.departmentId?.name || profile.department || null;
    const orderUsername = await ldapOrderUsername(profile.ldapUsername);
    return {
      owner: { authSource: 'ldap', username: orderUsername },
      actor: {
        userId: null,
        ldapUsername: orderUsername,
        orderUserName: profile.fullName || profile.ldapUsername,
        orderUserDepartment: department,
      },
      display: {
        _id: `ldap:${profile.ldapUsername}`,
        username: profile.ldapUsername,
        fullName: profile.fullName || profile.ldapUsername,
        department: department || 'بدون واحد',
        authSource: 'ldap',
      },
    };
  }

  if (local.status === 'inactive') throw httpError(400, 'این کاربر غیرفعال است');
  if (local.role === 'superadmin' && requester.role !== 'superadmin') {
    throw httpError(403, 'رزرو برای سوپر ادمین فقط توسط سوپر ادمین ممکن است');
  }
  return {
    owner: { authSource: 'local', id: String(local._id), username: local.username },
    actor: { userId: local._id, username: local.username },
    display: {
      _id: String(local._id),
      username: local.username,
      fullName: local.fullName || local.username,
      department: local.departmentId?.name || 'بدون واحد',
      authSource: 'local',
    },
  };
}

async function getUserWeekReservations(rawId, weekId, requester) {
  const target = await resolveTargetUser(rawId, requester);
  const filter = { $and: [await buildOrderOwnerFilter(target.owner), { status: { $ne: 'cancelled' } }] };
  if (weekId && mongoose.isValidObjectId(String(weekId))) filter.$and.push({ weekId: String(weekId) });
  const orders = await Order.find(filter)
    .sort({ orderDate: -1 })
    .populate('items.foodId', 'name price category')
    .populate({
      path: 'menuItemId',
      populate: [{ path: 'foodId', select: 'name price category' }, { path: 'dailyMenuId', select: 'date' }],
    })
    .lean();
  return { user: target.display, orders: await attachPaymentLocks(orders), ...(await manualReserveStatus()) };
}

/** رزرو توسط مدیر = تاییدشده؛ ظرفیت و «یک وعده در هر روز» مثل رزرو خود کاربر رعایت می‌شود */
async function reserveForUser(rawId, menuItemId, requester = {}) {
  await assertManualReserveEnabled();
  if (!/^[a-f0-9]{24}$/i.test(String(menuItemId || ''))) throw httpError(400, 'آیتم منو نامعتبر است');
  const target = await resolveTargetUser(rawId, requester);

  let claimed = null;
  try {
    const payload = await buildOrderFromMenuItem(String(menuItemId), target.actor);
    claimed = payload._capacityClaimed;
    delete payload._capacityClaimed;
    payload.status = 'confirmed';
    payload.placedBy = {
      userId: String(requester.id || ''),
      username: requester.username || null,
      fullName: requester.fullName || requester.username || null,
      role: requester.role || null,
    };
    const order = await Order.create(payload);
    writeSystemLog('info', 'orders', 'رزرو دستی مدیر برای کاربر', {
      orderNumber: order.orderNumber,
      user: target.display.username,
      by: requester.username,
    });
    return { user: target.display, order };
  } catch (error) {
    if (claimed) await releaseCapacity(claimed.menuItemId, claimed.quantity).catch(() => {});
    if (isDuplicateKeyError(error)) throw duplicateDayError(DUPLICATE_MESSAGE);
    throw error;
  }
}

module.exports = {
  manualReserveStatus,
  getUserWeekReservations,
  reserveForUser,
};
