const Food = require('../models/Food');
const MenuItem = require('../models/MenuItem');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

class FoodController {
  static async getAll(req, res, next) {
    try {
      const { category, includeInactive } = req.query;
      const filter = {};

      if (!toBool(includeInactive, false)) {
        filter.$and = [
          { $or: [{ status: 'active' }, { status: { $exists: false } }] },
          { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
        ];
      }
      if (category) {
        filter.category = category;
      }

      // Paginated only when the client asks for a page; other callers
      // (menu editor, legacy pages) still receive the full list.
      if (req.query.page !== undefined || req.query.limit !== undefined) {
        const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 100 });
        const [foods, total] = await Promise.all([
          Food.find(filter).sort({ category: 1, name: 1 }).skip(pageInfo.skip).limit(pageInfo.limit),
          Food.countDocuments(filter),
        ]);
        return res.json({
          success: true,
          data: foods,
          pagination: paginationMeta({ ...pageInfo, total }),
        });
      }

      const foods = await Food.find(filter).sort({ category: 1, name: 1 });
      res.json({ success: true, data: foods });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const food = await Food.findById(req.params.id);
      if (!food) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      res.json({ success: true, data: food });
    } catch (error) {
      next(error);
    }
  }

  static async getByCategory(req, res, next) {
    try {
      const foods = await Food.find({
        category: req.params.category,
        $and: [
          { $or: [{ status: 'active' }, { status: { $exists: false } }] },
          { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
        ],
      }).sort({ name: 1 });

      res.json({ success: true, data: foods });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, price, category, status, is_available, isAvailable } = req.body;

      if (!name || !price || !category) {
        return res.status(400).json({ message: 'نام، دسته بندی و قیمت الزامی هستند' });
      }

      const food = await Food.create({
        name: name.trim(),
        description,
        price: Number(String(price).replace(/,/g, '')),
        category,
        image: req.file ? req.file.filename : null,
        isAvailable: toBool(is_available ?? isAvailable, true),
        status: status || 'active',
      });

      res.status(201).json({ success: true, message: 'غذا اضافه شد', foodId: food._id });
    } catch (error) {
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const { name, description, price, category, status, is_available, isAvailable } = req.body;
      const food = await Food.findById(req.params.id);

      if (!food) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }

      food.name = name ?? food.name;
      food.description = description ?? food.description;
      food.price = price !== undefined ? Number(String(price).replace(/,/g, '')) : food.price;
      food.category = category ?? food.category;
      food.status = status ?? food.status;
      food.isAvailable = toBool(is_available ?? isAvailable, food.isAvailable);
      food.image = req.file ? req.file.filename : food.image;
      await food.save();

      res.json({ success: true, message: 'غذا بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const usedInMenu = await MenuItem.exists({ foodId: req.params.id });
      if (usedInMenu) {
        return res.status(409).json({ message: 'این غذا در منوی هفتگی استفاده شده و حذف مستقیم آن مجاز نیست' });
      }

      const food = await Food.findByIdAndDelete(req.params.id);
      if (!food) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }

      res.json({ success: true, message: 'غذا حذف شد' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FoodController;
