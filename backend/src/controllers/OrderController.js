const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const AppSetting = require('../models/AppSetting');
const { finalizeExpiredOrders, isCancelable, decorateOrder } = require('../helpers/OrderStatusHelper');
const { getUserCapabilities, stripPricesFromOrder, isAdminPortalUser } = require('../helpers/PermissionHelper');
const { resolveEffectiveCapacity } = require('../helpers/CapacityHelper');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');
const { formatJalaliDate } = require('../helpers/DateHelper');
const {
  orderOwnerFilter,
  buildOrderOwnerFilter,
  orderActorFromRequest,
} = require('../helpers/AuthUserHelper');
const {
  claimCapacity,
  releaseCapacity,
  releaseCapacityForOrder,
  syncMenuItemReservedCount,
  isDuplicateKeyError,
  duplicateDayError,
} = require('../helpers/ReservationHelper');

const ORDER_ID_RE = /^[a-f0-9]{24}$/i;

function orderLookup(identifier) {
  const value = String(identifier || '').trim();
  if (/^\d+$/.test(value)) return { orderNumber: Number(value) };
  return { _id: value };
}

async function buildOrderFromMenuItem(menuItemId, actor) {
  let menuItem = await MenuItem.findById(menuItemId)
    .populate('foodId')
    .populate('dailyMenuId');

  if (!menuItem) {
    const Week = require('../models/Week');
    const DailyMenu = require('../models/DailyMenu');
    const activeWeek = await Week.findOne({ isActive: true }).lean();
    if (activeWeek) {
      const dailyMenus = await DailyMenu.find({ weekId: activeWeek._id }).select('_id').lean();
      if (dailyMenus.length) {
        menuItem = await MenuItem.findOne({
          foodId: menuItemId,
          dailyMenuId: { $in: dailyMenus.map((day) => day._id) },
        })
          .populate('foodId')
          .populate('dailyMenuId');
      }
    }
  }

  const foodActive = menuItem && (!menuItem.foodId?.status || menuItem.foodId.status === 'active');
  const foodAvailable = menuItem && menuItem.foodId?.isAvailable !== false;
  if (!menuItem || !menuItem.isAvailable || !foodAvailable || !foodActive) {
    const error = new Error('آیتم منو قابل رزرو نیست');
    error.status = 404;
    throw error;
  }

  const dailyMenuId = menuItem.dailyMenuId._id || menuItem.dailyMenuId;
  const foodCategory = String(menuItem.foodId?.category || '').trim().toLowerCase() || 'uncategorized';
  const ownerFilter = orderOwnerFilter(
    actor.ldapUsername
      ? { authSource: 'ldap', username: actor.ldapUsername }
      : { authSource: 'local', id: actor.userId, username: actor.username },
  );
  if (actor.userId || actor.ldapUsername) {
    const existing = await Order.findOne({
      ...ownerFilter,
      dailyMenuId,
      foodCategory,
      status: { $ne: 'cancelled' },
    }).select('_id').lean();
    if (existing) {
      throw duplicateDayError('شما برای این وعده در این روز قبلاً غذا رزرو کرده اید');
    }
  }

  const settings = await AppSetting.findOne({ key: 'default' }).lean();
  const capacityEnabled = settings?.enableCapacityLimit !== false;
  const defaultCapacity = Number(settings?.defaultMenuItemCapacity ?? 20);
  const effectiveCapacity = resolveEffectiveCapacity(menuItem.maxCapacity, defaultCapacity, capacityEnabled);
  const resolvedMenuItemId = menuItem._id;
  const orderQuantity = 1;

  if (capacityEnabled && effectiveCapacity > 0) {
    await claimCapacity(resolvedMenuItemId, orderQuantity, effectiveCapacity);
  }

  const price = menuItem.customPrice ?? menuItem.foodId.price;
  const payload = {
    userId: actor.userId || null,
    ldapUsername: actor.ldapUsername || null,
    orderUserName: actor.orderUserName || null,
    orderUserDepartment: actor.orderUserDepartment || null,
    menuItemId: resolvedMenuItemId,
    dailyMenuId,
    foodCategory,
    weekId: menuItem.dailyMenuId.weekId,
    quantity: orderQuantity,
    totalPrice: price * orderQuantity,
    status: 'pending',
    orderDate: new Date(),
    items: [{ foodId: menuItem.foodId._id, quantity: orderQuantity, price }],
  };
  if (capacityEnabled && effectiveCapacity > 0) {
    payload._capacityClaimed = { menuItemId: resolvedMenuItemId, quantity: orderQuantity };
  }
  return payload;
}

function orderListResponse(orders, showPrices) {
  return orders.map((order) => stripPricesFromOrder(decorateOrder(order), showPrices));
}

const digitMap = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function normalizeFilterText(value) {
  return String(value || '')
    .replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] || digit)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .toLowerCase();
}

function orderFoodName(order) {
  return order.menuItemId?.foodId?.name
    || order.foodId?.name
    || order.items?.[0]?.foodId?.name
    || '';
}

function jalaliDateText(date) {
  if (!date) return '';
  try {
    return normalizeFilterText(formatJalaliDate(date));
  } catch {
    return '';
  }
}

function filterUserOrders(orders, query = {}) {
  const code = normalizeFilterText(query.code || query.orderNumber);
  const food = normalizeFilterText(query.food);
  const amount = normalizeFilterText(query.amount).replace(/[^\d]/g, '');
  const orderDate = normalizeFilterText(query.orderDate);
  const deliveryDate = normalizeFilterText(query.deliveryDate);
  const status = normalizeFilterText(query.status);

  if (!code && !food && !amount && !orderDate && !deliveryDate && !status) return orders;

  return orders.filter((order) => {
    if (code && !normalizeFilterText(order.orderNumber).includes(code.replace(/^#/, ''))) return false;
    if (food && !normalizeFilterText(orderFoodName(order)).includes(food)) return false;
    if (amount && !normalizeFilterText(order.totalPrice).includes(amount)) return false;
    if (orderDate && !jalaliDateText(order.orderDate).includes(orderDate)) return false;
    if (deliveryDate && !jalaliDateText(order.deliveryDate).includes(deliveryDate)) return false;
    if (status && normalizeFilterText(order.status) !== status) return false;
    return true;
  });
}

function hasUserOrderFilters(query = {}) {
  return ['code', 'orderNumber', 'food', 'amount', 'orderDate', 'deliveryDate', 'status']
    .some((key) => normalizeFilterText(query[key]));
}

function buildUserOrderDbFilter(baseFilter, query = {}) {
  const filter = { ...baseFilter };
  const code = normalizeFilterText(query.code || query.orderNumber).replace(/^#/, '');
  const amount = normalizeFilterText(query.amount).replace(/[^\d]/g, '');
  const status = normalizeFilterText(query.status);
  const validStatuses = ['pending', 'confirmed', 'ready', 'completed', 'cancelled'];

  if (/^\d+$/.test(code)) filter.orderNumber = Number(code);
  if (/^\d+$/.test(amount)) filter.totalPrice = Number(amount);
  if (validStatuses.includes(status)) filter.status = status;

  return filter;
}

const { isAutoConfirmMode } = require('../helpers/PaymentConfigHelper');
const {
  PAID_ORDER_LOCK_MESSAGE,
  isOrderPaymentLocked,
  attachPaymentLocks,
} = require('../helpers/PaymentLockHelper');
const { getSettingsLean } = require('../services/SettingsService');

const MANUAL_CONFIRM_BLOCKED = 'با فعال بودن پرداخت سبد خرید، سفارش‌ها پس از پرداخت به‌صورت خودکار تایید می‌شوند و تایید دستی ممکن نیست';

class OrderController {
  static async create(req, res, next) {
    let claimed = null;
    try {
      const actor = orderActorFromRequest(req);
      const { menu_item_id, menuItemId } = req.body;
      const selectedMenuItem = menu_item_id || menuItemId;
      if (!selectedMenuItem) {
        return res.status(400).json({
          message: 'رزرو فقط از طریق منوی هفته و با menuItemId مجاز است',
        });
      }

      const settings = await AppSetting.findOne({ key: 'default' }).lean();
      const maxActiveReservations = Number(settings?.maxActiveReservations || 0);

      const payload = await buildOrderFromMenuItem(selectedMenuItem, actor);
      claimed = payload._capacityClaimed;
      delete payload._capacityClaimed;

      if (maxActiveReservations > 0) {
        const confirmedReservationCount = await Order.countDocuments({
          ...orderOwnerFilter(req.user),
          weekId: payload.weekId,
          status: 'confirmed',
        });
        if (confirmedReservationCount >= maxActiveReservations) {
          if (claimed) await releaseCapacity(claimed.menuItemId, claimed.quantity);
          return res.status(409).json({ message: `حداکثر تعداد رزرو تاییدشده شما برای این هفته ${maxActiveReservations} سفارش است` });
        }
      }

      const order = await Order.create(payload);
      const showPrices = (await getUserCapabilities()).showPrices;
      res.status(201).json({
        success: true,
        message: 'سفارش ثبت شد',
        orderId: order._id,
        data: stripPricesFromOrder(decorateOrder(order), showPrices),
      });
    } catch (error) {
      if (claimed) {
        await releaseCapacity(claimed.menuItemId, claimed.quantity).catch(() => {});
      }
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({ message: 'شما برای این وعده در این روز قبلاً غذا رزرو کرده اید' });
      }
      next(error);
    }
  }

  static async cancel(req, res, next) {
    try {
      if (!ORDER_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      const filter = await buildOrderOwnerFilter(req.user);
      const order = await Order.findOne({ _id: req.params.id, ...filter });
      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }

      if (!isCancelable(order)) {
        return res.status(400).json({ message: 'مهلت لغو سفارش تمام شده است' });
      }
      if (await isOrderPaymentLocked(order._id)) {
        return res.status(409).json({ success: false, message: 'این سفارش پرداخت شده و قابل لغو نیست' });
      }

      await releaseCapacityForOrder(order);
      order.status = 'cancelled';
      await order.save();
      res.json({ success: true, message: 'رزرو لغو شد' });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      if (!ORDER_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      await finalizeExpiredOrders();
      const order = await Order.findById(req.params.id)
        .populate('userId', 'username fullName')
        .populate('items.foodId')
        .populate({
          path: 'menuItemId',
          populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }],
        });

      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }

      if (!isAdminPortalUser(req.user)) {
        const ownerFilter = await buildOrderOwnerFilter(req.user);
        const owned = await Order.findOne({ _id: order._id, ...ownerFilter }).select('_id').lean();
        if (!owned) {
          return res.status(404).json({ message: 'سفارش یافت نشد' });
        }
      }

      const showPrices = (await getUserCapabilities()).showPrices;
      res.json({ success: true, data: stripPricesFromOrder(decorateOrder(order), showPrices) });
    } catch (error) {
      next(error);
    }
  }

  static async getUserOrders(req, res, next) {
    try {
      const filter = await buildOrderOwnerFilter(req.user);
      await finalizeExpiredOrders(filter);
      const showPrices = (await getUserCapabilities()).showPrices;
      const baseQuery = () => Order.find(filter)
        .sort({ orderDate: -1 })
        .populate('items.foodId')
        .populate({
          path: 'menuItemId',
          populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }],
        });

      // Paginated only when the client asks for a page; the menu view still
      // needs the full list to lock already-ordered days.
      if (req.query.page !== undefined || req.query.limit !== undefined) {
        const pageInfo = paginationFromQuery(req.query, { limit: 10, maxLimit: 100 });
        if (hasUserOrderFilters(req.query)) {
          const filteredDbFilter = buildUserOrderDbFilter(filter, req.query);
          const allOrders = await Order.find(filteredDbFilter)
            .sort({ orderDate: -1 })
            .populate('items.foodId')
            .populate({
              path: 'menuItemId',
              populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }],
            });
          const filteredOrders = filterUserOrders(allOrders.map(decorateOrder), req.query);
          const total = filteredOrders.length;
          const orders = filteredOrders.slice(pageInfo.skip, pageInfo.skip + pageInfo.limit);
          return res.json({
            success: true,
            data: await attachPaymentLocks(orders.map((order) => stripPricesFromOrder(order, showPrices))),
            pagination: paginationMeta({ ...pageInfo, total }),
          });
        }

        const [orders, total] = await Promise.all([
          baseQuery()
            .skip(pageInfo.skip)
            .limit(pageInfo.limit),
          Order.countDocuments(filter),
        ]);
        return res.json({
          success: true,
          data: await attachPaymentLocks(orderListResponse(orders, showPrices)),
          pagination: paginationMeta({ ...pageInfo, total }),
        });
      }

      // نمای منو فقط سفارش‌های هفته‌های فعال را لازم دارد؛ با رشد سابقه، کل تاریخچه را نفرست
      if (String(req.query.activeWeeks || '') === '1') {
        const Week = require('../models/Week');
        const DailyMenu = require('../models/DailyMenu');
        const activeWeekIds = (await Week.find({ $or: [{ isActive: true }, { status: 'active' }] }).select('_id').lean())
          .map((w) => w._id);
        if (!activeWeekIds.length) return res.json({ success: true, data: [] });
        const dailyMenuIds = (await DailyMenu.find({ weekId: { $in: activeWeekIds } }).select('_id').lean()).map((d) => d._id);
        const scoped = await Order.find({
          $and: [filter, { $or: [{ weekId: { $in: activeWeekIds } }, { dailyMenuId: { $in: dailyMenuIds } }] }],
        })
          .sort({ orderDate: -1 })
          .populate('items.foodId')
          .populate({ path: 'menuItemId', populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }] });
        return res.json({ success: true, data: await attachPaymentLocks(orderListResponse(scoped, showPrices)) });
      }

      const orders = await baseQuery();
      res.json({ success: true, data: await attachPaymentLocks(orderListResponse(orders, showPrices)) });
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req, res, next) {
    try {
      await finalizeExpiredOrders();
      const { status, userId, weekId, orderNumber, search } = req.query;
      const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 100 });
      const filter = {};
      if (status) filter.status = status;
      if (userId) filter.userId = userId;
      if (weekId) filter.weekId = weekId;
      const requestedOrderNumber = orderNumber || search;
      if (requestedOrderNumber) {
        const parsedOrderNumber = Number(requestedOrderNumber);
        if (!Number.isInteger(parsedOrderNumber)) {
          return res.status(400).json({ success: false, message: 'کد سفارش نامعتبر است' });
        }
        filter.orderNumber = parsedOrderNumber;
      }

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .sort({ orderDate: -1 })
          .skip(pageInfo.skip)
          .limit(pageInfo.limit)
          .populate('userId', 'username fullName')
          .populate('dailyMenuId', 'date')
          .populate('items.foodId')
          .populate({
            path: 'menuItemId',
            populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }],
          }),
        Order.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: await attachPaymentLocks(orders.map(decorateOrder)),
        pagination: paginationMeta({ ...pageInfo, total }),
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const validStatuses = ['pending', 'confirmed', 'ready', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'وضعیت نامعتبر است' });
      }

      if (!ORDER_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      const existing = await Order.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      if ((status === 'cancelled' || status === 'pending') && status !== existing.status
        && await isOrderPaymentLocked(existing._id)) {
        return res.status(409).json({ success: false, message: PAID_ORDER_LOCK_MESSAGE });
      }
      if (status === 'confirmed' && existing.status !== 'confirmed' && isAutoConfirmMode(await getSettingsLean())) {
        return res.status(409).json({ success: false, message: MANUAL_CONFIRM_BLOCKED });
      }
      const wasCancelled = existing.status === 'cancelled';
      if (status === 'cancelled' && !wasCancelled) {
        await releaseCapacityForOrder(existing);
      }
      existing.status = status;
      try {
        await existing.save();
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          return res.status(409).json({ message: 'این کاربر برای همین وعده سفارش فعال دیگری دارد؛ بازگردانی ممکن نیست' });
        }
        throw err;
      }
      // لغو → فعال: شمارنده ظرفیت از روی سفارش‌های واقعی همگام شود
      if (wasCancelled && status !== 'cancelled' && existing.menuItemId) {
        await syncMenuItemReservedCount(existing.menuItemId).catch(() => {});
      }

      res.json({ success: true, message: 'وضعیت سفارش بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async adminCancel(req, res, next) {
    try {
      const order = await Order.findOne(orderLookup(req.params.id));
      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }

      if (order.status === 'cancelled') {
        return res.json({ success: true, message: `سفارش ${order.orderNumber || ''} قبلا لغو شده است` });
      }
      if (await isOrderPaymentLocked(order._id)) {
        return res.status(409).json({ success: false, message: PAID_ORDER_LOCK_MESSAGE });
      }

      await releaseCapacityForOrder(order);
      order.status = 'cancelled';
      await order.save();

      res.json({ success: true, message: `سفارش ${order.orderNumber || ''} لغو شد` });
    } catch (error) {
      next(error);
    }
  }

  static async confirmWeek(req, res, next) {
    try {
      if (isAutoConfirmMode(await getSettingsLean())) {
        return res.status(409).json({ success: false, message: MANUAL_CONFIRM_BLOCKED });
      }
      const Week = require('../models/Week');
      let filter = { status: 'pending' };
      const weekId = req.body?.weekId;
      if (weekId) {
        filter.weekId = weekId;
      } else if (req.body?.scope !== 'all') {
        const activeWeek = await Week.findOne({ isActive: true });
        if (!activeWeek) return res.status(404).json({ success: false, message: 'هفته فعالی وجود ندارد' });
        filter.weekId = activeWeek._id;
      }
      const result = await Order.updateMany(filter, { $set: { status: 'confirmed' } });
      res.json({ success: true, count: result.modifiedCount, message: `${result.modifiedCount} سفارش تایید شد` });
    } catch (error) {
      next(error);
    }
  }

  static async adminCreate(req, res, next) {
    return res.status(404).json({ success: false, message: 'این مسیر غیرفعال است' });
  }

  static async delete(req, res, next) {
    try {
      if (!ORDER_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      const order = await Order.findByIdAndDelete(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      // حذف سفارش فعال باید ظرفیت رزروشده منو را آزاد کند
      if (order.menuItemId && order.status !== 'cancelled') {
        await syncMenuItemReservedCount(order.menuItemId).catch(() => {});
      }
      res.json({ success: true, message: 'سفارش حذف شد' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = OrderController;
module.exports.buildOrderFromMenuItem = buildOrderFromMenuItem;
