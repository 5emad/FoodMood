const SHOWCASE_SLIDES = [
  {
    title: 'مرغ ترش',
    description: 'خوراک اصیل گیلانی با طعم ترش و شیرین انار و سبزی‌های معطر',
    imageUrl: '/uploads/portal-slides/morgh-torsh.jpg',
    tags: ['گیلان', 'سنتی'],
    badge: 'اسلاید',
    enabled: true,
  },
  {
    title: 'قورمه سبزی',
    description: 'خورشت سنتی ایرانی با سبزی معطر، لوبیا قرمز و گوشت تازه',
    imageUrl: '/uploads/portal-slides/ghormeh-sabzi.jpg',
    tags: ['خورشت', 'سنتی'],
    badge: 'اسلاید',
    enabled: true,
  },
  {
    title: 'فسنجان',
    description: 'خورشت اصفهانی با گردو، رب انار و طعمی ملایم و اصیل',
    imageUrl: '/uploads/portal-slides/fesenjan.jpg',
    tags: ['اصفهان', 'خورشت'],
    badge: 'اسلاید',
    enabled: true,
  },
  {
    title: 'چلوکباب',
    description: 'کباب کوبیده با برنج زعفرانی، غذای محبوب و ملی ایران',
    imageUrl: '/uploads/portal-slides/chelow-kebab.jpg',
    tags: ['کباب', 'محبوب'],
    badge: 'اسلاید',
    enabled: true,
  },
  {
    title: 'تهچین',
    description: 'پلو کره‌ای با ته‌دیگ طلایی و لایه‌های معطر و خوشمزه',
    imageUrl: '/uploads/portal-slides/tahchin.jpg',
    tags: ['پلو', 'ته‌دیگ'],
    badge: 'اسلاید',
    enabled: true,
  },
  {
    title: 'زرشک‌پلو با مرغ',
    description: 'پلو زعفرانی با زرشک ترش و مرغ پخته، طعمی متعادل و دلپذیر',
    imageUrl: '/uploads/portal-slides/zereshk-polo.jpg',
    tags: ['پلو', 'مرغ'],
    badge: 'اسلاید',
    enabled: true,
  },
];

const defaultPortalSlider = {
  weekHeroImage: '/uploads/portal-slides/morgh-torsh.jpg',
  weekHeroEnabled: true,
  showAnnouncementSlides: true,
  showMenuFoodSlides: true,
  showcaseSlides: SHOWCASE_SLIDES,
};

function parseEnabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  return Boolean(value);
}

function resolvePortalImageUrl(url, fallback = '') {
  let value = String(url || '').trim();
  if (!value) value = String(fallback || '').trim();
  // Legacy SVG placeholders were removed after downloading real JPG assets.
  if (value.endsWith('.svg') && value.includes('/uploads/portal-slides/')) {
    value = value.replace(/\.svg$/i, '.jpg');
  }
  return value;
}

function normalizePortalSliderConfig(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const showcase = Array.isArray(base.showcaseSlides) && base.showcaseSlides.length
    ? base.showcaseSlides.map((slide, index) => {
      const fallback = defaultPortalSlider.showcaseSlides[index] || {};
      return {
        title: String(slide?.title || fallback.title || '').trim(),
        description: String(slide?.description || fallback.description || '').trim(),
        imageUrl: resolvePortalImageUrl(slide?.imageUrl, fallback.imageUrl),
        tags: Array.isArray(slide?.tags)
          ? slide.tags.map((t) => String(t).trim()).filter(Boolean)
          : (fallback.tags || []),
        badge: String(slide?.badge || fallback.badge || 'اسلاید').trim(),
        enabled: parseEnabled(slide?.enabled, true),
      };
    })
    : defaultPortalSlider.showcaseSlides.map((slide) => ({ ...slide }));

  while (showcase.length < 6) {
    const fallback = defaultPortalSlider.showcaseSlides[showcase.length];
    if (fallback) showcase.push({ ...fallback });
    else break;
  }

  return {
    weekHeroImage: resolvePortalImageUrl(base.weekHeroImage, defaultPortalSlider.weekHeroImage),
    weekHeroEnabled: parseEnabled(base.weekHeroEnabled, true),
    showAnnouncementSlides: parseEnabled(base.showAnnouncementSlides, true),
    showMenuFoodSlides: parseEnabled(base.showMenuFoodSlides, true),
    showcaseSlides: showcase.slice(0, 6),
  };
}

function portalSliderFromBody(body = {}) {
  if (body.portalSlider === undefined) return null;
  let raw = body.portalSlider;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  return normalizePortalSliderConfig(raw);
}

module.exports = {
  defaultPortalSlider,
  normalizePortalSliderConfig,
  portalSliderFromBody,
};
