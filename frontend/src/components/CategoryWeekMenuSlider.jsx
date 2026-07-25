import { useEffect, useMemo, useRef, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectFade, Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-fade';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import {
  categoryLabel,
  groupItemsByCategory,
  normalizeCategoryKey,
} from '../lib/foodCategories';
import { jdate, money } from '../utils/format';
import '../styles/category-week-menu-slider.css';

function DayCardsGrid({
  menu,
  days,
  filterCategoryKey = null,
  showPrices,
  orderedDayCategories,
  orderByItem,
  pendingItems,
  onPlaceOrder,
  onCancelOrder,
}) {
  return (
    <div className="menu-grid">
      {days.map((day) => {
        const dayId = String(day._id);
        const items = filterCategoryKey
          ? (day.items || []).filter(
            (item) => normalizeCategoryKey(item.foodId?.category) === filterCategoryKey,
          )
          : (day.items || []);
        return (
          <div key={day._id} className="day-card">
            <div className="day-card-header">
              <span className="day-name">{day.dayId?.name || ''}</span>
              <span className="day-date-badge">{jdate(day.date)}</span>
            </div>
            <div className="day-card-body">
              {items.length ? items.map((item) => {
                const cap = Number(item.effectiveCapacity) || 0;
                const full = cap > 0 && item.reservedCount >= cap;
                const order = orderByItem[String(item._id)];
                const catKey = normalizeCategoryKey(item.foodId?.category);
                const categoryTaken = orderedDayCategories.has(`${dayId}|${catKey}`);
                return (
                  <div key={item._id} className="food-row">
                    <div>
                      <div className="food-name">{item.foodId?.name || '-'}</div>
                      {showPrices && <div className="food-price">{money(item.price)}</div>}
                      {menu.settings?.enableCapacityLimit && cap > 0 && (
                        <div className="capacity-note">
                          <i className="fas fa-users" style={{ fontSize: '.6rem' }} />
                          <span>رزرو شده: {item.reservedCount || 0} از {cap}</span>
                        </div>
                      )}
                    </div>
                    <div className="menu-actions">
                      {order ? (
                        order.canCancel
                          ? (
                            <button type="button" className="btn-cancel-order" onClick={() => onCancelOrder(order._id)}>
                              <i className="fas fa-xmark" /> لغو رزرو
                            </button>
                          )
                          : <span className="status-confirmed"><i className="fas fa-check" /> تایید شده</span>
                      ) : categoryTaken ? (
                        <button type="button" className="btn-reserve" disabled>سفارش دارید</button>
                      ) : (
                        <button
                          type="button"
                          className="btn-reserve"
                          disabled={full || pendingItems.has(item._id)}
                          onClick={() => onPlaceOrder(item._id)}
                        >
                          {full ? 'ظرفیت تکمیل' : pendingItems.has(item._id) ? 'در حال رزرو...' : 'رزرو'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div className="day-empty"><p>غذایی برای این روز ثبت نشده</p></div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * همان گرید ۶ روزه؛ فقط اگر ۲ دسته یا بیشتر در منوی هفته باشد، اسلایدر می‌شود
 * (هر اسلاید = همان باکس‌های روز برای یک دسته).
 */
export default function CategoryWeekMenuSlider({
  menu,
  categories = [],
  showPrices = false,
  orderedDayCategories,
  orderByItem,
  pendingItems,
  onPlaceOrder,
  onCancelOrder,
}) {
  const days = menu?.days || [];
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [swiper, setSwiper] = useState(null);

  useEffect(() => {
    if (!swiper) return;
    const nav = swiper.params.navigation;
    if (!nav || typeof nav === 'boolean') return;
    nav.prevEl = prevRef.current;
    nav.nextEl = nextRef.current;
    swiper.navigation.destroy();
    swiper.navigation.init();
    swiper.navigation.update();
  }, [swiper]);

  const activeCategoryKeys = useMemo(() => {
    const keys = new Set();
    for (const day of days) {
      for (const item of day.items || []) {
        if (!item.foodId?.name) continue;
        keys.add(normalizeCategoryKey(item.foodId?.category));
      }
    }
    if (!keys.size) return [];
    return groupItemsByCategory(
      [...keys].map((key) => ({ category: key })),
      (x) => x.category,
      categories,
    ).map((g) => g.key);
  }, [days, categories]);

  if (!menu) {
    return (
      <div className="empty-state">
        <i className="fas fa-calendar-xmark" />
        <p>برنامه غذایی فعالی وجود ندارد.</p>
      </div>
    );
  }

  if (!days.length) return null;

  const shared = {
    menu,
    days,
    showPrices,
    orderedDayCategories,
    orderByItem,
    pendingItems,
    onPlaceOrder,
    onCancelOrder,
  };

  if (activeCategoryKeys.length < 2) {
    return <DayCardsGrid {...shared} filterCategoryKey={null} />;
  }

  return (
    <div className="category-week-menu-slider">
      <div className="cwm-toolbar">
        <button
          type="button"
          ref={prevRef}
          className="cwm-nav-btn"
          aria-label="دسته قبلی"
        >
          <i className="fas fa-chevron-right" />
        </button>

        <div className="cwm-tabs" role="tablist" aria-label="دسته‌های منو">
          {activeCategoryKeys.map((key, index) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              className={`cwm-tab${activeIndex === index ? ' is-active' : ''}`}
              onClick={() => swiper?.slideTo(index)}
            >
              <i className="fas fa-utensils" />
              {categoryLabel(categories, key)}
            </button>
          ))}
        </div>

        <button
          type="button"
          ref={nextRef}
          className="cwm-nav-btn"
          aria-label="دسته بعدی"
        >
          <i className="fas fa-chevron-left" />
        </button>
      </div>

      <Swiper
        modules={[EffectFade, Navigation, Pagination]}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        slidesPerView={1}
        spaceBetween={0}
        autoHeight
        onSwiper={setSwiper}
        onSlideChange={(s) => setActiveIndex(s.activeIndex)}
        navigation
        pagination={{
          clickable: true,
          dynamicBullets: true,
        }}
        className="category-week-swiper"
      >
        {activeCategoryKeys.map((key) => (
          <SwiperSlide key={key}>
            <div className="cwm-slide-wrap">
              <DayCardsGrid {...shared} filterCategoryKey={key} />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
