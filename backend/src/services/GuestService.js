const Guest = require('../models/Guest');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const AppSetting = require('../models/AppSetting');
const { generateUniqueGuestCode } = require('../helpers/GuestCodeHelper');
const { resolveEffectiveCapacity } = require('../helpers/CapacityHelper');
const { parseJalaliDate, endOfJalaliDay } = require('../helpers/DateHelper');
const { escapeRegex } = require('../helpers/SecurityHelper');
const {
  claimCapacity,
  releaseCapacity,
  isDuplicateKeyError,
  duplicateDayError,
} = require('../helpers/ReservationHelper');

function guestTypeLabel(type) {
  return type === 'permanent' ? 'دائم' : 'موقت';
}

function resolveGuestValidUntil(value) {
  if (value === null || value === '') return null;
  if (!value) return null;
  const asJalaliEnd = endOfJalaliDay(value);
  if (asJalaliEnd) return asJalaliEnd;
  const asJalaliStart = parseJalaliDate(value);
  if (asJalaliStart) {
    asJalaliStart.setHours(23, 59, 59, 999);
    return asJalaliStart;
  }
  const asDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    const error = new Error('تاریخ اعتبار شمسی نامعتبر است');
    error.status = 400;
    throw error;
  }
  return asDate;
}

function isGuestActive(guest) {
  if (!guest || guest.status !== 'active') return false;
  if (guest.guestType === 'temporary' && guest.validUntil) {
    return new Date(guest.validUntil).getTime() >= Date.now();
  }
  return true;
}

async function listGuests(query = {}) {
  const filter = {};
  if (query.status) filter.status = String(query.status);
  if (query.guestType) filter.guestType = String(query.guestType);
  if (query.search) {
    const term = escapeRegex(String(query.search).trim().slice(0, 80));
    if (term) {
      filter.$or = [
        { fullName: { $regex: term, $options: 'i' } },
        { guestCode: term },
        { department: { $regex: term, $options: 'i' } },
      ];
    }
  }
  return Guest.find(filter).sort({ createdAt: -1 }).lean();
}

async function createGuest(payload = {}, createdBy = '') {
  const fullName = String(payload.fullName || '').trim();
  if (!fullName) {
    const error = new Error('نام مهمان الزامی است');
    error.status = 400;
    throw error;
  }
  const guestType = payload.guestType === 'permanent' ? 'permanent' : 'temporary';
  const guestCode = await generateUniqueGuestCode(4);
  const guest = await Guest.create({
    guestCode,
    fullName,
    guestType,
    department: String(payload.department || '').trim(),
    validUntil: guestType === 'temporary' && payload.validUntil ? resolveGuestValidUntil(payload.validUntil) : null,
    status: payload.status === 'inactive' ? 'inactive' : 'active',
    notes: String(payload.notes || '').trim(),
    createdBy,
  });
  return guest;
}

async function updateGuest(guestId, payload = {}) {
  const guest = await Guest.findById(guestId);
  if (!guest) {
    const error = new Error('مهمان یافت نشد');
    error.status = 404;
    throw error;
  }
  if (payload.fullName !== undefined) guest.fullName = String(payload.fullName || '').trim();
  if (payload.department !== undefined) guest.department = String(payload.department || '').trim();
  if (payload.notes !== undefined) guest.notes = String(payload.notes || '').trim();
  if (payload.status !== undefined) guest.status = payload.status === 'inactive' ? 'inactive' : 'active';
  if (payload.guestType !== undefined) {
    guest.guestType = payload.guestType === 'permanent' ? 'permanent' : 'temporary';
  }
  if (payload.validUntil !== undefined) {
    guest.validUntil = guest.guestType === 'temporary' && payload.validUntil
      ? resolveGuestValidUntil(payload.validUntil)
      : null;
  }
  await guest.save();
  return guest;
}

async function deleteGuest(guestId) {
  const guest = await Guest.findById(guestId);
  if (!guest) {
    const error = new Error('مهمان یافت نشد');
    error.status = 404;
    throw error;
  }
  const activeOrders = await Order.countDocuments({
    guestId: guest._id,
    status: { $nin: ['cancelled'] },
  });
  if (activeOrders) {
    const error = new Error('این مهمان سفارش فعال دارد و قابل حذف نیست');
    error.status = 409;
    throw error;
  }
  await guest.deleteOne();
  return guest;
}

async function buildGuestOrderFromMenuItem(menuItemId, guest) {
  if (!isGuestActive(guest)) {
    const error = new Error('مهمان غیرفعال یا منقضی شده است');
    error.status = 400;
    throw error;
  }

  const menuItem = await MenuItem.findById(menuItemId)
    .populate('foodId')
    .populate('dailyMenuId');
  const foodActive = menuItem && (!menuItem.foodId?.status || menuItem.foodId.status === 'active');
  const foodAvailable = menuItem && menuItem.foodId?.isAvailable !== false;
  if (!menuItem || !menuItem.isAvailable || !foodAvailable || !foodActive) {
    const error = new Error('آیتم منو قابل رزرو نیست');
    error.status = 404;
    throw error;
  }

  const dailyMenuId = menuItem.dailyMenuId._id || menuItem.dailyMenuId;
  const existingDayOrder = await Order.findOne({
    guestId: guest._id,
    dailyMenuId,
    status: { $ne: 'cancelled' },
  }).select('_id').lean();
  if (existingDayOrder) {
    throw duplicateDayError('این مهمان برای این روز قبلاً غذا رزرو کرده است');
  }

  const settings = await AppSetting.findOne({ key: 'default' }).lean();
  const defaultCapacity = Number(settings?.defaultMenuItemCapacity ?? 20);
  const effectiveCapacity = resolveEffectiveCapacity(menuItem.maxCapacity, defaultCapacity);
  await claimCapacity(menuItem._id, 1, effectiveCapacity);

  const price = menuItem.customPrice ?? menuItem.foodId.price;
  return {
    guestId: guest._id,
    orderUserName: guest.fullName,
    orderUserDepartment: guest.department || 'مهمان',
    menuItemId: menuItem._id,
    dailyMenuId,
    weekId: menuItem.dailyMenuId.weekId,
    quantity: 1,
    totalPrice: price,
    status: 'confirmed',
    orderDate: new Date(),
    items: [{ foodId: menuItem.foodId._id, quantity: 1, price }],
    _capacityClaimed: { menuItemId: menuItem._id, quantity: 1 },
  };
}

async function reserveForGuest(guestId, menuItemId) {
  let claimed = null;
  try {
    const guest = await Guest.findById(guestId);
    if (!guest) {
      const error = new Error('مهمان یافت نشد');
      error.status = 404;
      throw error;
    }
    const payload = await buildGuestOrderFromMenuItem(menuItemId, guest);
    claimed = payload._capacityClaimed;
    delete payload._capacityClaimed;
    const order = await Order.create(payload);
    return { guest, order };
  } catch (error) {
    if (claimed) {
      await releaseCapacity(claimed.menuItemId, claimed.quantity).catch(() => {});
    }
    if (isDuplicateKeyError(error)) {
      throw duplicateDayError('این مهمان برای این روز قبلاً غذا رزرو کرده است');
    }
    throw error;
  }
}

async function getGuestWeekReservations(guestId, weekId) {
  const guest = await Guest.findById(guestId).lean();
  if (!guest) {
    const error = new Error('مهمان یافت نشد');
    error.status = 404;
    throw error;
  }
  const filter = { guestId: guest._id, status: { $ne: 'cancelled' } };
  if (weekId) filter.weekId = weekId;
  const orders = await Order.find(filter)
    .sort({ orderDate: -1 })
    .populate('items.foodId', 'name price')
    .populate({
      path: 'menuItemId',
      populate: [{ path: 'foodId', select: 'name price' }, { path: 'dailyMenuId', select: 'date' }],
    })
    .lean();
  return { guest, orders };
}

module.exports = {
  guestTypeLabel,
  isGuestActive,
  listGuests,
  createGuest,
  updateGuest,
  deleteGuest,
  reserveForGuest,
  getGuestWeekReservations,
};
