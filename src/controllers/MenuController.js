const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const { defaultSettings, getOrCreateSettings, getSettingsLean } = require('../services/SettingsService');
const { getUserCapabilities, stripPricesFromMenuPayload, isAdminPortalUser } = require('../helpers/PermissionHelper');

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
        effectiveCapacity: Number(item.maxCapacity) > 0 && Number(item.maxCapacity) !== 50 ? Number(item.maxCapacity) : defaultCapacity,
      })),
    };
  }));
}

class MenuController {
  static async getWeeklyMenu(req, res, next) {
    try {
      const week = req.params.weekId
        ? await Week.findById(req.params.weekId).lean()
        : await Week.findOne({ $or: [{ isActive: true }, { status: 'active' }] }).lean();

      if (!week) {
        return res.status(404).json({ message: 'برنامه فعالی وجود ندارد' });
      }

      const dailyMenus = await DailyMenu.find({ weekId: week._id })
        .populate('dayId')
        .sort({ date: 1 })
        .lean();
      const settings = await getSettingsLean();
      const capabilities = isAdminPortalUser(req.user)
        ? { showPrices: true, showStatement: true }
        : await getUserCapabilities();

      const inner = {
          week,
          settings: {
            showPricesToUsers: capabilities.showPrices,
            showFinancialStatementToUsers: capabilities.showStatement !== false,
            defaultMenuItemCapacity: settings.defaultMenuItemCapacity ?? defaultSettings.defaultMenuItemCapacity,
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

      const settings = await getSettingsLean();
      const defaultCapacity = Number(settings?.defaultMenuItemCapacity ?? defaultSettings.defaultMenuItemCapacity);
      const item = await MenuItem.create({
        dailyMenuId: dailyMenu,
        foodId: food,
        maxCapacity: Math.max(Number(max_capacity ?? maxCapacity ?? defaultCapacity), 0),
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
      const { max_capacity, maxCapacity, custom_price, customPrice, is_available, isAvailable } = req.body;
      const update = {};

      if (max_capacity !== undefined || maxCapacity !== undefined) update.maxCapacity = Number(max_capacity ?? maxCapacity);
      if (custom_price !== undefined || customPrice !== undefined) update.customPrice = custom_price || customPrice || null;
      if (is_available !== undefined || isAvailable !== undefined) {
        update.isAvailable = ['1', 'true', 'yes', 'on'].includes(String(is_available ?? isAvailable).toLowerCase());
      }

      const item = await MenuItem.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!item) {
        return res.status(404).json({ message: 'آیتم منو یافت نشد' });
      }

      res.json({ success: true, message: 'آیتم منو بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async deleteItem(req, res, next) {
    try {
      const reservedCount = await Order.countDocuments({ menuItemId: req.params.id });
      if (reservedCount > 0) {
        return res.status(409).json({ message: 'این آیتم دارای سفارش است و قابل حذف نیست' });
      }

      const item = await MenuItem.findByIdAndDelete(req.params.id);
      if (!item) {
        return res.status(404).json({ message: 'آیتم منو یافت نشد' });
      }

      res.json({ success: true, message: 'آیتم منو حذف شد' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = MenuController;
