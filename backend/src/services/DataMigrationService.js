/**
 * مهاجرت‌های داده‌ای idempotent — اجرا در هر راه‌اندازی سرور
 */
const Food = require('../models/Food');
const AppSetting = require('../models/AppSetting');
const { ensureDefaultCategories } = require('../controllers/FoodCategoryController');
const { BRAND } = require('../controllers/ThemeController');

/**
 * حذف کامل فیلدهای منسوخ نوع وعده از غذاها
 */
async function removeFoodServingTypeFields() {
  const result = await Food.collection.updateMany(
    {
      $or: [
        { servingType: { $exists: true } },
        { isType1: { $exists: true } },
      ],
    },
    { $unset: { servingType: '', isType1: '' } },
  );
  if (result.modifiedCount > 0) {
    console.log(`[migration] servingType/isType1: از ${result.modifiedCount} غذا حذف شد`);
  }
}

/**
 * هم‌تراز کردن رنگ تم ذخیره‌شده با برند Coloro 125-28-38
 */
async function syncBrandThemeSettings() {
  const result = await AppSetting.updateOne(
    { key: 'default' },
    {
      $set: {
        themePrimary: BRAND.primary,
        themePrimaryLight: BRAND.primaryLight,
        themePrimaryDark: BRAND.primaryDark,
        themeGradientFrom: BRAND.gradientFrom,
        themeGradientTo: BRAND.gradientTo,
      },
    },
  );
  if (result.modifiedCount > 0) {
    console.log('[migration] theme: رنگ برند Coloro 125-28-38 اعمال شد');
  }
}

/**
 * اطمینان از وجود دسته‌بندی‌های پیش‌فرض (ناهار، صبحانه، ...)
 */
async function ensureFoodCategories() {
  await ensureDefaultCategories();
}

/**
 * پر کردن foodCategory سفارش‌های قدیمی + به‌روزرسانی ایندکس یکتایی (روز+دسته)
 */
async function backfillOrderFoodCategoryAndIndexes() {
  const Order = require('../models/Order');
  const missing = await Order.find({
    $or: [
      { foodCategory: { $exists: false } },
      { foodCategory: null },
      { foodCategory: '' },
    ],
  })
    .select('_id items menuItemId foodCategory')
    .populate({ path: 'menuItemId', select: 'foodId', populate: { path: 'foodId', select: 'category' } })
    .populate({ path: 'items.foodId', select: 'category' })
    .lean();

  let updated = 0;
  for (const row of missing) {
    const cat = String(
      row.menuItemId?.foodId?.category
      || row.items?.[0]?.foodId?.category
      || 'uncategorized',
    ).trim().toLowerCase() || 'uncategorized';
    await Order.updateOne({ _id: row._id }, { $set: { foodCategory: cat } });
    updated += 1;
  }
  if (updated > 0) {
    console.log(`[migration] order.foodCategory: ${updated} سفارش به‌روزرسانی شد`);
  }

  // حذف ایندکس قدیمی یک‌رزرو-در-روز و ساخت ایندکس روز+دسته
  const legacyIndexNames = [
    'userId_1_dailyMenuId_1',
    'ldapUsername_1_dailyMenuId_1',
    'guestId_1_dailyMenuId_1',
  ];
  for (const name of legacyIndexNames) {
    try {
      await Order.collection.dropIndex(name);
      console.log(`[migration] dropped legacy index ${name}`);
    } catch (err) {
      if (err?.codeName !== 'IndexNotFound' && err?.code !== 27) {
        console.warn(`[migration] drop ${name}:`, err.message);
      }
    }
  }
  try {
    await Order.syncIndexes();
  } catch (err) {
    console.warn('[migration] Order.syncIndexes:', err.message);
  }
}

async function runDataMigrations() {
  await removeFoodServingTypeFields().catch((err) => {
    console.warn('[migration] remove servingType:', err.message);
  });
  await syncBrandThemeSettings().catch((err) => {
    console.warn('[migration] theme brand:', err.message);
  });
  await ensureFoodCategories().catch((err) => {
    console.warn('[migration] food categories:', err.message);
  });
  await backfillOrderFoodCategoryAndIndexes().catch((err) => {
    console.warn('[migration] order foodCategory:', err.message);
  });
}

module.exports = {
  runDataMigrations,
  removeFoodServingTypeFields,
  syncBrandThemeSettings,
  ensureFoodCategories,
  backfillOrderFoodCategoryAndIndexes,
};
