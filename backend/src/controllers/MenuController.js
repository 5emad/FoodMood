const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const { defaultSettings, getSettingsLean } = require('../services/SettingsService');
const { getUserCapabilities, stripPricesFromMenuPayload, isAdminPortalUser } = require('../helpers/PermissionHelper');
const { resolveEffectiveCapacity } = require('../helpers/CapacityHelper');
const { cancelOrdersForMenuItems } = require('../helpers/OrderStatusHelper');
const { countLockedOrdersForMenuItems } = require('../helpers/PaymentLockHelper');

function paidMenuItemMessage(count) {
  return `${count.toLocaleString('fa-IR')} سفارش پرداخت‌شده روی این غذا ثبت شده است؛ تغییر یا حذف آن (که سفارش‌ها را لغو می‌کند) ممکن نیست. فقط با حذف کل هفته لغو می‌شوند.`;
}
const { writeSystemLog } = require('../services/SystemLogService');

async function attachMenuItems(dailyMenus, settings) {
  const defaultCapacity = Number(settings?.defaultMenuItemCapacity ?? defaultSettings.defaultMenuItemCapacity);
  return Promise.all(dailyMenus.map(async (dailyMenu) => {
    const items = await MenuItem.find({ dailyMenuId: dailyMenu._id })
      .populate('foodId')
      .sort({ createdAt: 1 })
      .lean();

    const counts = await Order.aggregate([
      { $match: { menuItemId: { $in: items.map((item) => item._id) }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$menuItemId', count: { $sum: '$quantity' } } },
    ]);
    const countMap = new Map(counts.map((row) => [String(row._id), row.count]));

    return {
      ...dailyMenu,
      items: items.map((item) => ({
        ...item,
        price: item.customPrice ?? item.foodId?.price,
        reservedCount: countMap.get(String(item._id)) || 0,
        effectiveCapacity: resolveEffectiveCapacity(
          item.maxCapacity,
          defaultCapacity,
          settings?.enableCapacityLimit !== false,
        ),
      })),
    };
  }));
}

class MenuController {
  static async listActiveWeeks(req, res, next) {
    try {
      const weeks = await Week.find({ $or: [{ isActive: true }, { status: 'active' }] })
        .sort({ startDate: 1 })
        .lean();
      const { formatJalaliDate } = require('../helpers/DateHelper');
      res.json({
        success: true,
        data: weeks.map((week) => ({
          _id: week._id,
          name: week.name,
          weekNumber: week.weekNumber,
          startDate: week.startDate,
          endDate: week.endDate,
          jalaliStart: formatJalaliDate(week.startDate),
          jalaliEnd: formatJalaliDate(week.endDate),
          isActive: !!week.isActive,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  static async getWeeklyMenu(req, res, next) {
    try {
      const rawWeekId = req.params.weekId || req.query.weekId || '';
      const requestedWeekId = typeof rawWeekId === 'string' ? rawWeekId.trim() : '';
      if (requestedWeekId && !/^[a-f0-9]{24}$/i.test(requestedWeekId)) {
        return res.status(404).json({ message: 'برنامه یافت نشد' });
      }
      // نمای مدیریتی (ویرایشگر هفته/رزرو مهمان) فقط با درخواست صریح scope=admin و نقش مدیر.
      // پرتال کاربر — حتی وقتی مدیر آن را باز می‌کند — همیشه تنظیم «نمایش قیمت» را رعایت می‌کند.
      const isAdminWeekEditor = isAdminPortalUser(req.user) && String(req.query.scope || '') === 'admin';
      let week;
      if (requestedWeekId) {
        week = await Week.findById(requestedWeekId).lean();
        // کاربران فقط هفته‌های منتشرشده (فعال) را می‌بینند
        if (week && !isAdminWeekEditor && !(week.isActive || week.status === 'active')) {
          week = null;
        }
      } else {
        const activeWeeks = await Week.find({ $or: [{ isActive: true }, { status: 'active' }] })
          .sort({ startDate: 1 })
          .lean();
        week = activeWeeks[0] || null;
      }

      if (!week) {
        return res.status(404).json({ message: 'برنامه فعالی وجود ندارد' });
      }

      const dailyMenus = await DailyMenu.find({ weekId: week._id })
        .populate('dayId')
        .sort({ date: 1 })
        .lean();
      const settings = await getSettingsLean();
      const capabilities = isAdminWeekEditor
        ? { showPrices: true, showStatement: true }
        : await getUserCapabilities();

      const inner = {
          week,
          settings: {
            showPricesToUsers: capabilities.showPrices,
            showFinancialStatementToUsers: capabilities.showStatement !== false,
            defaultMenuItemCapacity: settings.defaultMenuItemCapacity ?? defaultSettings.defaultMenuItemCapacity,
            enableCapacityLimit: settings.enableCapacityLimit !== false,
          },
          days: await attachMenuItems(dailyMenus, settings),
        };

      res.json({
        success: true,
        data: stripPricesFromMenuPayload(inner, capabilities.showPrices),
      });
    } catch (error) {
      next(error);
    }
  }

  static async addItem(req, res, next) {
    try {
      const { daily_menu_id, dailyMenuId, food_id, foodId, max_capacity, maxCapacity, custom_price, customPrice } = req.body;
      const dailyMenu = daily_menu_id || dailyMenuId;
      const food = food_id || foodId;

      if (!dailyMenu || !food) {
        return res.status(400).json({ message: 'روز منو و غذا الزامی هستند' });
      }

      // 0 = inherit system default capacity at reservation time
      const hasExplicitCapacity = max_capacity !== undefined || maxCapacity !== undefined;
      const item = await MenuItem.create({
        dailyMenuId: dailyMenu,
        foodId: food,
        maxCapacity: hasExplicitCapacity ? Math.max(Number(max_capacity ?? maxCapacity) || 0, 0) : 0,
        customPrice: custom_price || customPrice || null,
        isAvailable: true,
      });

      res.status(201).json({ success: true, message: 'آیتم منو اضافه شد', data: item });
    } catch (error) {
      next(error);
    }
  }

  static async updateItem(req, res, next) {
    try {
      const {
        max_capacity, maxCapacity, custom_price, customPrice,
        is_available, isAvailable, food_id, foodId,
      } = req.body;
      const update = {};
      let cancelledCount = 0;

      const existing = await MenuItem.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: 'آیتم منو یافت نشد' });
      }

      const nextFoodId = food_id || foodId;
      if (nextFoodId !== undefined && String(nextFoodId) !== String(existing.foodId)) {
        const locked = await countLockedOrdersForMenuItems([existing._id]);
        if (locked > 0) return res.status(409).json({ success: false, message: paidMenuItemMessage(locked) });
        // عوض کردن غذای این آیتم → لغو سفارش‌های قبلی همین آیتم
        const cancelResult = await cancelOrdersForMenuItems([existing._id]);
        cancelledCount = cancelResult.cancelledCount;
        update.foodId = nextFoodId;
      }

      if (max_capacity !== undefined || maxCapacity !== undefined) update.maxCapacity = Number(max_capacity ?? maxCapacity);
      if (custom_price !== undefined || customPrice !== undefined) update.customPrice = custom_price || customPrice || null;
      if (is_available !== undefined || isAvailable !== undefined) {
        update.isAvailable = ['1', 'true', 'yes', 'on'].includes(String(is_available ?? isAvailable).toLowerCase());
      }

      const item = await MenuItem.findByIdAndUpdate(req.params.id, update, { new: true });

      if (cancelledCount > 0) {
        writeSystemLog('info', 'menu', 'لغو سفارش‌ها به‌خاطر تغییر غذای منو', {
          event: 'menu_item_food_changed_orders_cancelled',
          menuItemId: String(req.params.id),
          cancelledCount,
          actorId: req.user?.id || null,
        });
      }

      res.json({
        success: true,
        message: cancelledCount > 0
          ? `آیتم منو بروزرسانی شد و ${cancelledCount} سفارش لغو گردید`
          : 'آیتم منو بروزرسانی شد',
        cancelledCount,
        data: item,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteItem(req, res, next) {
    try {
      const item = await MenuItem.findById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: 'آیتم منو یافت نشد' });
      }

      const locked = await countLockedOrdersForMenuItems([item._id]);
      if (locked > 0) return res.status(409).json({ success: false, message: paidMenuItemMessage(locked) });

      // حذف غذا از منوی روز → لغو سفارش‌های همان غذا (از گزارش هم خارج می‌شوند)
      const { cancelledCount } = await cancelOrdersForMenuItems([item._id]);
      await MenuItem.findByIdAndDelete(item._id);

      if (cancelledCount > 0) {
        writeSystemLog('info', 'menu', 'لغو سفارش‌ها به‌خاطر حذف غذا از منو', {
          event: 'menu_item_removed_orders_cancelled',
          menuItemId: String(item._id),
          dailyMenuId: String(item.dailyMenuId || ''),
          foodId: String(item.foodId || ''),
          cancelledCount,
          actorId: req.user?.id || null,
        });
      }

      res.json({
        success: true,
        message: cancelledCount > 0
          ? `آیتم منو حذف شد و ${cancelledCount} سفارش مرتبط لغو گردید`
          : 'آیتم منو حذف شد',
        cancelledCount,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = MenuController;
