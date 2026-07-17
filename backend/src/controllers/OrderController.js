const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const AppSetting = require('../models/AppSetting');
const { finalizeExpiredOrders, isCancelable, decorateOrder } = require('../helpers/OrderStatusHelper');
const { getUserCapabilities, stripPricesFromOrder, isAdminPortalUser } = require('../helpers/PermissionHelper');
const { resolveEffectiveCapacity } = require('../helpers/CapacityHelper');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');
const {
  orderOwnerFilter,
  buildOrderOwnerFilter,
  orderActorFromRequest,
} = require('../helpers/AuthUserHelper');
const {
  claimCapacity,
  releaseCapacity,
  releaseCapacityForOrder,
  isDuplicateKeyError,
  duplicateDayError,
} = require('../helpers/ReservationHelper');

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
  const ownerFilter = orderOwnerFilter(
    actor.ldapUsername
      ? { authSource: 'ldap', username: actor.ldapUsername }
      : { authSource: 'local', id: actor.userId },
  );
  if (actor.userId || actor.ldapUsername) {
    const existing = await Order.findOne({
      ...ownerFilter,
      dailyMenuId,
      status: { $ne: 'cancelled' },
    }).select('_id').lean();
    if (existing) {
      throw duplicateDayError('شما برای این روز قبلا غذا رزرو کرده اید');
    }
  }

  const settings = await AppSetting.findOne({ key: 'default' }).lean();
  const defaultCapacity = Number(settings?.defaultMenuItemCapacity ?? 20);
  const effectiveCapacity = resolveEffectiveCapacity(menuItem.maxCapacity, defaultCapacity);
  const resolvedMenuItemId = menuItem._id;
  const orderQuantity = 1;

  await claimCapacity(resolvedMenuItemId, orderQuantity, effectiveCapacity);

  const price = menuItem.customPrice ?? menuItem.foodId.price;
  return {
    userId: actor.userId || null,
    ldapUsername: actor.ldapUsername || null,
    orderUserName: actor.orderUserName || null,
    orderUserDepartment: actor.orderUserDepartment || null,
    menuItemId: resolvedMenuItemId,
    dailyMenuId,
    weekId: menuItem.dailyMenuId.weekId,
    quantity: orderQuantity,
    totalPrice: price * orderQuantity,
    status: 'pending',
    orderDate: new Date(),
    items: [{ foodId: menuItem.foodId._id, quantity: orderQuantity, price }],
    _capacityClaimed: { menuItemId: resolvedMenuItemId, quantity: orderQuantity },
  };
}

function orderListResponse(orders, showPrices) {
  return orders.map((order) => stripPricesFromOrder(decorateOrder(order), showPrices));
}

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
        return res.status(409).json({ message: 'شما برای این روز قبلا غذا رزرو کرده اید' });
      }
      next(error);
    }
  }

  static async cancel(req, res, next) {
    try {
      const filter = await buildOrderOwnerFilter(req.user);
      const order = await Order.findOne({ _id: req.params.id, ...filter });
      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }

      if (!isCancelable(order)) {
        return res.status(400).json({ message: 'مهلت لغو سفارش تمام شده است' });
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
          return res.status(403).json({ message: 'دسترسی غیرمجاز' });
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
        const [orders, total] = await Promise.all([
          baseQuery().skip(pageInfo.skip).limit(pageInfo.limit),
          Order.countDocuments(filter),
        ]);
        return res.json({
          success: true,
          data: orderListResponse(orders, showPrices),
          pagination: paginationMeta({ ...pageInfo, total }),
        });
      }

      const orders = await baseQuery();
      res.json({ success: true, data: orderListResponse(orders, showPrices) });
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
          .populate('items.foodId')
          .populate({
            path: 'menuItemId',
            populate: [{ path: 'foodId' }, { path: 'dailyMenuId' }],
          }),
        Order.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: orders.map(decorateOrder),
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

      const existing = await Order.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      if (status === 'cancelled' && existing.status !== 'cancelled') {
        await releaseCapacityForOrder(existing);
      }
      existing.status = status;
      await existing.save();

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
      const order = await Order.findByIdAndDelete(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'سفارش یافت نشد' });
      }
      res.json({ success: true, message: 'سفارش حذف شد' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = OrderController;

