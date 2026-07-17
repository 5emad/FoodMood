import { useMemo } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Pagination } from 'swiper/modules';
import { faDigits, money } from '../utils/format';
import 'swiper/css';
import 'swiper/css/pagination';
import '../styles/user-hero-slider.css';

function slideThumb(slide) {
  return slide.imageUrl || '/uploads/portal-slides/morgh-torsh.jpg';
}

export default function UserHeroSlider({ slides = [], showPrices = true, loading = false }) {
  const items = useMemo(() => (slides || []).filter((s) => s?.title), [slides]);

  if (loading) {
    return (
      <div className="portal-hero-slider portal-hero-slider--loading">
        <div className="portal-hero-skeleton" />
      </div>
    );
  }

  if (!items.length) return null;

  return (
    <div className="portal-hero-slider">
      <Swiper
        modules={[Pagination, Autoplay]}
        slidesPerView={1}
        loop={items.length > 1}
        speed={650}
        autoplay={{ delay: 5200, disableOnInteraction: false, pauseOnMouseEnter: true }}
        pagination={{ clickable: true }}
        dir="rtl"
        className="portal-hero-swiper"
      >
        {items.map((slide, index) => {
          const bg = slideThumb(slide);
          const showPrice = showPrices && slide.price != null && slide.price !== '';
          return (
            <SwiperSlide key={`${slide.type || 'slide'}-${slide.announcementId || slide.foodId || index}`}>
              <article className="portal-hero-slide" style={{ backgroundImage: `url(${bg})` }}>
                <div className="portal-hero-overlay" />
                <div className="portal-hero-pattern" aria-hidden="true" />
                <div className="portal-hero-content">
                  {slide.badge && (
                    <span className="portal-hero-badge">
                      <i className={`fas ${slide.type === 'announcement' ? 'fa-bullhorn' : slide.type === 'week' ? 'fa-calendar-week' : 'fa-utensils'}`} />
                      {slide.badge}
                    </span>
                  )}
                  <h2 className="portal-hero-title">{slide.title}</h2>
                  {/* توضیح فقط در کارت پایین؛ بالا فقط برای اسلاید هفته/اطلاعیه اگر توضیح کوتاه لازم باشد */}
                  {slide.type !== 'showcase' && slide.subtitle && (
                    <p className="portal-hero-subtitle">{slide.subtitle}</p>
                  )}
                </div>
                <div className="portal-hero-glass">
                  <div className="portal-hero-glass-thumb" style={{ backgroundImage: `url(${bg})` }} aria-hidden="true" />
                  <div className="portal-hero-glass-body">
                    <div className="portal-hero-glass-title">{slide.title}</div>
                    {slide.subtitle && <div className="portal-hero-glass-desc">{slide.subtitle}</div>}
                    {showPrice && <div className="portal-hero-glass-price">{money(slide.price)}</div>}
                    {slide.tags?.length > 0 && (
                      <div className="portal-hero-tags">
                        {slide.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="portal-hero-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
}
