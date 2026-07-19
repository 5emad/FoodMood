const Food = require('../models/Food');
const FoodCategory = require('../models/FoodCategory');

const DEFAULT_CATEGORIES = [
  { key: 'lunch', name: 'ناهار', sortOrder: 1 },
  { key: 'breakfast', name: 'صبحانه', sortOrder: 2 },
  { key: 'dinner', name: 'شام', sortOrder: 3 },
  { key: 'snack', name: 'میان وعده', sortOrder: 4 },
];

function slugifyKey(input) {
  const raw = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s‌]+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06ff-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (raw) return raw.slice(0, 48);
  return `cat-${Date.now().toString(36)}`;
}

async function ensureDefaultCategories() {
  const count = await FoodCategory.countDocuments();
  if (count > 0) return;
  await FoodCategory.insertMany(DEFAULT_CATEGORIES);
}

class FoodCategoryController {
  static async list(req, res, next) {
    try {
      await ensureDefaultCategories();
      const includeInactive = String(req.query.includeInactive || '') === 'true'
        && req.user
        && ['admin', 'superadmin'].includes(req.user.role);
      const filter = includeInactive ? {} : { status: 'active' };
      const data = await FoodCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'نام دسته الزامی است' });

      let key = String(req.body?.key || '').trim().toLowerCase();
      if (!key) key = slugifyKey(name);
      else key = slugifyKey(key);

      const exists = await FoodCategory.findOne({ key });
      if (exists) return res.status(409).json({ success: false, message: 'این کلید دسته از قبل وجود دارد' });

      const maxSort = await FoodCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
      const category = await FoodCategory.create({
        key,
        name,
        sortOrder: Number(req.body?.sortOrder ?? ((maxSort?.sortOrder || 0) + 1)),
        status: 'active',
      });
      res.status(201).json({ success: true, message: 'دسته ایجاد شد', data: category });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, message: 'این کلید دسته تکراری است' });
      }
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const category = await FoodCategory.findById(req.params.id);
      if (!category) return res.status(404).json({ success: false, message: 'دسته یافت نشد' });

      const name = req.body?.name !== undefined ? String(req.body.name).trim() : category.name;
      if (!name) return res.status(400).json({ success: false, message: 'نام دسته الزامی است' });

      const prevKey = category.key;
      if (req.body?.key !== undefined) {
        const nextKey = slugifyKey(req.body.key);
        if (nextKey !== prevKey) {
          const clash = await FoodCategory.findOne({ key: nextKey, _id: { $ne: category._id } });
          if (clash) return res.status(409).json({ success: false, message: 'این کلید دسته از قبل وجود دارد' });
          category.key = nextKey;
          await Food.updateMany({ category: prevKey }, { $set: { category: nextKey } });
        }
      }

      category.name = name;
      if (req.body?.sortOrder !== undefined) category.sortOrder = Number(req.body.sortOrder) || 0;
      if (req.body?.status) category.status = req.body.status === 'inactive' ? 'inactive' : 'active';
      await category.save();

      res.json({ success: true, message: 'دسته بروزرسانی شد', data: category });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req, res, next) {
    try {
      const category = await FoodCategory.findById(req.params.id);
      if (!category) return res.status(404).json({ success: false, message: 'دسته یافت نشد' });

      const used = await Food.exists({ category: category.key });
      if (used) {
        return res.status(409).json({
          success: false,
          message: 'این دسته روی غذاها استفاده شده و قابل حذف نیست. ابتدا غذاها را جابه‌جا کنید.',
        });
      }

      await FoodCategory.findByIdAndDelete(category._id);
      res.json({ success: true, message: 'دسته حذف شد' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FoodCategoryController;
