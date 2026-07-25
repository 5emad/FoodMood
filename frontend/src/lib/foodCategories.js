/** ابزار گروه‌بندی غذا/آیتم منو بر اساس Food.category (کلید دسته) */

export function normalizeCategoryKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key || 'uncategorized';
}

const CATEGORY_FALLBACK_NAMES = {
  lunch: 'ناهار',
  breakfast: 'صبحانه',
  dinner: 'شام',
  snack: 'میان وعده',
  uncategorized: 'بدون دسته',
};

export function categoryLabel(categories, key) {
  const k = normalizeCategoryKey(key);
  const hit = (categories || []).find((c) => normalizeCategoryKey(c.key) === k);
  if (hit?.name) return hit.name;
  return CATEGORY_FALLBACK_NAMES[k] || k;
}

export function sortCategories(categories) {
  return [...(categories || [])].sort((a, b) => {
    const so = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (so !== 0) return so;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
  });
}

/**
 * groupItemsByCategory(items, getCategoryKey, categories)
 * returns [{ key, name, sortOrder, items }]
 */
export function groupItemsByCategory(items, getCategoryKey, categories = []) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeCategoryKey(getCategoryKey(item));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  const known = sortCategories(categories);
  const orderedKeys = [];
  for (const cat of known) {
    const k = normalizeCategoryKey(cat.key);
    if (map.has(k)) orderedKeys.push(k);
  }
  for (const k of map.keys()) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }

  return orderedKeys.map((key) => {
    const meta = known.find((c) => normalizeCategoryKey(c.key) === key);
    return {
      key,
      name: meta?.name || categoryLabel(categories, key),
      sortOrder: Number(meta?.sortOrder || 999),
      items: map.get(key) || [],
    };
  });
}

/** غذاهای یکتای هفته از منوی فعال */
export function uniqueWeekFoods(menu) {
  const map = new Map();
  for (const day of menu?.days || []) {
    for (const item of day.items || []) {
      const food = item.foodId;
      const id = String(food?._id || item._id || '');
      if (!id || !food?.name) continue;
      if (!map.has(id)) {
        map.set(id, {
          _id: id,
          name: food.name,
          description: food.description || '',
          category: normalizeCategoryKey(food.category),
          price: item.price,
          image: food.image || '',
        });
      }
    }
  }
  return [...map.values()];
}
