const fs = require('fs');
const path = require('path');
const Food = require('../models/Food');
const MenuItem = require('../models/MenuItem');
const { writeSecurityLog } = require('../services/SecurityLogService');
const { paginationFromQuery, paginationMeta } = require('../helpers/PaginationHelper');
const {
  resolveShowPricesForRequest,
  stripPricesFromFood,
  stripPricesFromFoodList,
  isAdminPortalUser,
} = require('../helpers/PermissionHelper');

function toBool(value, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'foods');
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_PRICE = 1_000_000_000;
const MAX_BULK = 500;

function str(value) {
  if (Array.isArray(value)) value = value.find((v) => typeof v === 'string');
  return typeof value === 'string' ? value : '';
}

/** Parses "120,000" / "۱۲۰۰۰۰" / 120000 → integer price, or null when invalid. */
function parsePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const latin = String(value)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s\u066C]/g, '');
  if (!/^\d+(\.\d+)?$/.test(latin)) return null;
  const num = Math.round(Number(latin));
  if (!Number.isFinite(num) || num < 0 || num > MAX_PRICE) return null;
  return num;
}

function validateFoodFields({ name, price, category, description, status }, { partial = false } = {}) {
  const out = {};
  if (!partial || name !== undefined) {
    const v = str(name).trim().replace(/\s+/g, ' ');
    if (!v || v.length > 80) return { error: 'نام غذا الزامی است و نباید بیشتر از ۸۰ کاراکتر باشد' };
    out.name = v;
  }
  if (!partial || price !== undefined) {
    const p = parsePrice(price);
    if (p === null) return { error: 'قیمت معتبر نیست' };
    out.price = p;
  }
  if (!partial || category !== undefined) {
    const c = str(category).trim();
    if (!c || c.length > 64) return { error: 'دسته‌بندی معتبر نیست' };
    out.category = c;
  }
  if (description !== undefined) {
    const d = str(description).trim();
    if (d.length > 500) return { error: 'توضیحات نباید بیشتر از ۵۰۰ کاراکتر باشد' };
    out.description = d;
  }
  if (status !== undefined) {
    const s = str(status).trim();
    if (!['active', 'inactive'].includes(s)) return { error: 'وضعیت غذا معتبر نیست' };
    out.status = s;
  }
  return { data: out };
}

/** Removes an uploaded food image (only plain filenames inside the uploads dir). */
function removeFoodImage(filename) {
  const base = path.basename(String(filename || ''));
  if (!base || base !== filename || base.startsWith('.')) return;
  const full = path.join(UPLOAD_DIR, base);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) return;
  fs.promises.unlink(full).catch(() => {});
}

class FoodController {
  static async getAll(req, res, next) {
    try {
      const { category, includeInactive } = req.query;
      const filter = {};

      // فقط ادمین می‌تواند غذاهای غیرفعال را ببیند
      const allowInactive = toBool(includeInactive, false) && isAdminPortalUser(req.user);
      if (!allowInactive) {
        filter.$and = [
          { $or: [{ status: 'active' }, { status: { $exists: false } }] },
          { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
        ];
      }
      if (category) {
        filter.category = str(category).slice(0, 64);
      }

      // Paginated only when the client asks for a page; other callers
      // (menu editor, legacy pages) still receive the full list.
      if (req.query.page !== undefined || req.query.limit !== undefined) {
        const pageInfo = paginationFromQuery(req.query, { limit: 20, maxLimit: 100 });
        const [foods, total] = await Promise.all([
          Food.find(filter).sort({ category: 1, name: 1 }).skip(pageInfo.skip).limit(pageInfo.limit),
          Food.countDocuments(filter),
        ]);
        const showPrices = await resolveShowPricesForRequest(req);
        return res.json({
          success: true,
          data: stripPricesFromFoodList(foods, showPrices),
          pagination: paginationMeta({ ...pageInfo, total }),
        });
      }

      const foods = await Food.find(filter).sort({ category: 1, name: 1 });
      const showPrices = await resolveShowPricesForRequest(req);
      res.json({ success: true, data: stripPricesFromFoodList(foods, showPrices) });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      if (!OBJECT_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      const food = await Food.findById(req.params.id);
      if (!food) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      const inactive = food.status === 'inactive' || food.isAvailable === false;
      if (inactive && !isAdminPortalUser(req.user)) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      const showPrices = await resolveShowPricesForRequest(req);
      res.json({ success: true, data: stripPricesFromFood(food, showPrices) });
    } catch (error) {
      next(error);
    }
  }

  static async getByCategory(req, res, next) {
    try {
      const foods = await Food.find({
        category: str(req.params.category).slice(0, 64),
        $and: [
          { $or: [{ status: 'active' }, { status: { $exists: false } }] },
          { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
        ],
      }).sort({ name: 1 });

      const showPrices = await resolveShowPricesForRequest(req);
      res.json({ success: true, data: stripPricesFromFoodList(foods, showPrices) });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, description, price, category, status, is_available, isAvailable } = req.body;
      const { data, error } = validateFoodFields({ name, price, category, description, status });
      if (error) {
        if (req.file) removeFoodImage(req.file.filename);
        return res.status(400).json({ message: error });
      }

      const food = await Food.create({
        ...data,
        image: req.file ? req.file.filename : null,
        isAvailable: toBool(is_available ?? isAvailable, true),
        status: data.status || 'active',
      });

      res.status(201).json({ success: true, message: 'غذا اضافه شد', foodId: food._id });
    } catch (error) {
      next(error);
    }
  }

  static async update(req, res, next) {
    try {
      const { name, description, price, category, status, is_available, isAvailable } = req.body;
      const food = OBJECT_ID_RE.test(String(req.params.id || '')) ? await Food.findById(req.params.id) : null;

      if (!food) {
        if (req.file) removeFoodImage(req.file.filename);
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }

      const { data, error } = validateFoodFields({ name, price, category, description, status }, { partial: true });
      if (error) {
        if (req.file) removeFoodImage(req.file.filename);
        return res.status(400).json({ message: error });
      }

      Object.assign(food, data);
      food.isAvailable = toBool(is_available ?? isAvailable, food.isAvailable);
      const previousImage = food.image;
      if (req.file) food.image = req.file.filename;
      await food.save();
      if (req.file && previousImage && previousImage !== food.image) removeFoodImage(previousImage);

      res.json({ success: true, message: 'غذا بروزرسانی شد' });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      if (!OBJECT_ID_RE.test(String(req.params.id || ''))) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      const usedInMenu = await MenuItem.exists({ foodId: req.params.id });
      if (usedInMenu) {
        return res.status(409).json({ message: 'این غذا در منوی هفتگی استفاده شده و حذف مستقیم آن مجاز نیست؛ می‌توانید آن را غیرفعال کنید' });
      }

      const food = await Food.findByIdAndDelete(req.params.id);
      if (!food) {
        return res.status(404).json({ message: 'غذا یافت نشد' });
      }
      removeFoodImage(food.image);
      await writeSecurityLog(req, 'foods_deleted', null, 'Food deleted', {
        actorId: req.user?.id, count: 1, names: [food.name],
      });

      res.json({ success: true, message: 'غذا حذف شد' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * حذف گروهی غذاها.
   * body: { ids: [...] }  یا  { all: true, category?: '...' }
   * غذاهایی که در منوی هفتگی استفاده شده‌اند حذف نمی‌شوند و در skipped برمی‌گردند.
   */
  static async bulkDelete(req, res, next) {
    try {
      const body = req.body || {};
      const deleteAll = body.all === true;
      let filter;
      if (deleteAll) {
        filter = {};
        const category = str(body.category).trim();
        if (category) filter.category = category.slice(0, 64);
      } else {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const unique = [...new Set(ids.filter((id) => typeof id === 'string' && OBJECT_ID_RE.test(id)))];
        if (!unique.length) {
          return res.status(400).json({ success: false, message: 'هیچ غذایی برای حذف انتخاب نشده است' });
        }
        if (unique.length > MAX_BULK) {
          return res.status(400).json({ success: false, message: `حداکثر ${MAX_BULK} غذا در هر بار قابل حذف است` });
        }
        filter = { _id: { $in: unique } };
      }

      const candidates = await Food.find(filter).select('_id name image').limit(5000).lean();
      if (!candidates.length) {
        return res.json({ success: true, message: 'غذایی برای حذف یافت نشد', data: { deleted: 0, skipped: [] } });
      }

      const usedIds = new Set(
        (await MenuItem.distinct('foodId', { foodId: { $in: candidates.map((f) => f._id) } })).map(String),
      );
      const deletable = candidates.filter((f) => !usedIds.has(String(f._id)));
      const skipped = candidates
        .filter((f) => usedIds.has(String(f._id)))
        .map((f) => ({ id: String(f._id), name: f.name }));

      let deleted = 0;
      if (deletable.length) {
        const result = await Food.deleteMany({ _id: { $in: deletable.map((f) => f._id) } });
        deleted = result.deletedCount || 0;
        deletable.forEach((f) => removeFoodImage(f.image));
        await writeSecurityLog(req, 'foods_deleted', null, 'Foods bulk-deleted', {
          actorId: req.user?.id,
          count: deleted,
          all: deleteAll,
          names: deletable.slice(0, 50).map((f) => f.name),
        });
      }

      const fa = (n) => Number(n).toLocaleString('fa-IR');
      let message = deleted ? `${fa(deleted)} غذا حذف شد` : 'هیچ غذایی حذف نشد';
      if (skipped.length) {
        message += `؛ ${fa(skipped.length)} غذا چون در منوی هفتگی استفاده شده حذف نشد (می‌توانید غیرفعالش کنید)`;
      }
      return res.json({ success: true, message, data: { deleted, skipped } });
    } catch (error) {
      next(error);
    }
  }

  /** فعال/غیرفعال‌سازی گروهی غذاها — جایگزین امن برای غذاهای استفاده‌شده در منو */
  static async bulkStatus(req, res, next) {
    try {
      const body = req.body || {};
      const status = str(body.status);
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ success: false, message: 'وضعیت معتبر نیست' });
      }
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const unique = [...new Set(ids.filter((id) => typeof id === 'string' && OBJECT_ID_RE.test(id)))];
      if (!unique.length || unique.length > MAX_BULK) {
        return res.status(400).json({ success: false, message: 'انتخاب غذاها معتبر نیست' });
      }
      const result = await Food.updateMany(
        { _id: { $in: unique } },
        { $set: { status, isAvailable: status === 'active' } },
      );
      const n = Number(result.modifiedCount || 0).toLocaleString('fa-IR');
      return res.json({
        success: true,
        message: status === 'active' ? `${n} غذا فعال شد` : `${n} غذا غیرفعال شد`,
        data: { modified: result.modifiedCount || 0 },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FoodController;
