const Week = require('../models/Week');
const DailyMenu = require('../models/DailyMenu');
const MenuItem = require('../models/MenuItem');
const AnnouncementService = require('./AnnouncementService');
const { getSettingsLean } = require('./SettingsService');
const { getUserCapabilities } = require('../helpers/PermissionHelper');
const { normalizePortalSliderConfig } = require('../helpers/PortalSliderDefaults');
const { formatJalaliDate } = require('../helpers/DateHelper');

function truncateText(text, max = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function weekSubtitle(week) {
  if (!week) return 'در حال بارگذاری...';
  if (week.name) return week.name;
  const start = week.startDate ? formatJalaliDate(week.startDate) : '';
  const end = week.endDate ? formatJalaliDate(week.endDate) : '';
  if (start && end) return `${start} تا ${end}`;
  return 'هفته جاری';
}

function enabledShowcaseSlides(config) {
  return (config.showcaseSlides || []).filter((slide) => slide && slide.enabled === true && slide.title);
}

function findShowcaseImage(foodName, config) {
  const name = String(foodName || '').trim();
  if (!name) return '';
  const match = enabledShowcaseSlides(config).find((slide) => slide.title && name.includes(slide.title));
  return match?.imageUrl || '';
}

async function loadActiveMenuFoods() {
  const week = await Week.findOne({ $or: [{ isActive: true }, { status: 'active' }] }).lean();
  if (!week) return { week: null, foods: [] };

  const dailyMenus = await DailyMenu.find({ weekId: week._id }).sort({ date: 1 }).lean();
  const items = await MenuItem.find({ dailyMenuId: { $in: dailyMenus.map((d) => d._id) } })
    .populate('foodId')
    .lean();

  const seen = new Set();
  const foods = [];
  for (const item of items) {
    const food = item.foodId;
    if (!food?._id || seen.has(String(food._id))) continue;
    seen.add(String(food._id));
    foods.push({
      foodId: food._id,
      name: food.name,
      description: food.description || '',
      category: food.category || '',
      imageUrl: food.image || '',
      price: item.customPrice ?? food.price,
    });
  }

  return { week, foods };
}

async function buildPortalSlides(options = {}) {
  const settings = options.settings || await getSettingsLean();
  const capabilities = options.capabilities || await getUserCapabilities();
  const showPrices = capabilities.showPrices !== false;
  const config = normalizePortalSliderConfig(settings.portalSlider);
  const showcase = enabledShowcaseSlides(config);

  const week = options.week !== undefined
    ? options.week
    : (await loadActiveMenuFoods()).week;

  let announcements = options.announcements;
  if (!announcements) {
    announcements = options.user
      ? await AnnouncementService.listActiveForUser(options.user)
      : [];
  }

  let menuFoods = options.menuFoods;
  if (!menuFoods) {
    menuFoods = (await loadActiveMenuFoods()).foods;
  }

  const slides = [];

  // اسلاید ۱: هفته جاری
  if (config.weekHeroEnabled) {
    slides.push({
      type: 'week',
      badge: 'هفته جاری',
      title: 'برنامه غذایی هفته',
      subtitle: weekSubtitle(week),
      imageUrl: config.weekHeroImage,
      tags: ['منوی هفته'],
    });
  }

  // اسلاید ۲(+): اطلاعیه‌ها
  if (config.showAnnouncementSlides && announcements?.length) {
    announcements.slice(0, 3).forEach((ann) => {
      slides.push({
        type: 'announcement',
        badge: 'اطلاعیه',
        title: ann.title,
        subtitle: truncateText(ann.body),
        imageUrl: config.weekHeroImage,
        tags: ['جدید'],
        announcementId: ann._id,
      });
    });
  }

  // اسلایدهای بعدی: محتوای قابل‌ویرایش از تنظیمات
  showcase.forEach((slide) => {
    slides.push({
      type: 'showcase',
      badge: slide.badge || 'اسلاید',
      title: slide.title,
      subtitle: slide.description || '',
      imageUrl: slide.imageUrl || config.weekHeroImage,
      tags: slide.tags || [],
    });
  });

  if (config.showMenuFoodSlides && menuFoods?.length) {
    menuFoods.forEach((food) => {
      slides.push({
        type: 'menu',
        badge: 'منوی فعال',
        title: food.name,
        subtitle: food.description || 'در منوی این هفته موجود است',
        imageUrl: food.imageUrl || findShowcaseImage(food.name, config) || config.weekHeroImage,
        tags: food.category ? [food.category] : ['منو'],
        price: showPrices ? food.price : null,
        foodId: food.foodId,
      });
    });
  }

  return {
    slides,
    showPrices,
    config,
  };
}

module.exports = {
  buildPortalSlides,
  loadActiveMenuFoods,
};
