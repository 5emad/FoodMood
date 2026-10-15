import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { jdate, money } from '../../../utils/format';
import { categoryLabel, normalizeCategoryKey } from '../../../lib/foodCategories';

function weekSelectLabel(w) {
  const prefix = w.isActive ? 'فعال - ' : '';
  return `${prefix}${w.jalaliStart} تا ${w.jalaliEnd}`;
}

function dayJalali(dateValue) {
  return dateValue ? jdate(dateValue) : '';
}

function orderFoodName(order) {
  return order.menuItemId?.foodId?.name
    || (order.items || []).map((i) => i.foodId?.name).filter(Boolean).join('، ')
    || 'رزرو شده';
}

/**
 * کشوی رزرو هفتگی توسط مدیر (مهمان‌ها و کاربران).
 * loadReservations(weekId) → { orders, enabled?, reason? }؛ reserve(menuItemId) → bool
 * onCancel(order) اختیاری است؛ رزرو هر دسته غذا در هر روز جداگانه است.
 */
export default function WeeklyReserveDrawer({
  open, title, name, subtitle, loadReservations, reserve, onCancel, onClose,
}) {
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState('');
  const [categories, setCategories] = useState([]);
  const [menuDays, setMenuDays] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [blockedReason, setBlockedReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    document.body.classList.toggle('guest-drawer-open', !!open);
    return () => document.body.classList.remove('guest-drawer-open');
  }, [open]);

  async function loadWeek(wid) {
    if (!wid) {
      setMenuDays([]);
      setReservations([]);
      return;
    }
    setLoading(true);
    const [menu, res] = await Promise.all([
      api(`/api/menu/weeks/${encodeURIComponent(wid)}?scope=admin`),
      loadReservations(wid),
    ]);
    setMenuDays(menu.success ? menu.data?.days || [] : []);
    setReservations(res?.orders || []);
    setBlockedReason(res && res.enabled === false ? (res.reason || 'رزرو دستی غیرفعال است') : '');
    setLoading(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    (async () => {
      const [w, cats] = await Promise.all([
        api('/api/admin/weeks?noSync=true'),
        api('/api/foods/categories'),
      ]);
      if (!alive) return;
      const wl = w.success ? w.data : [];
      setWeeks(wl);
      setCategories(cats.success ? cats.data || [] : []);
      const wid = wl.find((x) => x.isActive)?._id || wl[0]?._id || '';
      setWeekId(wid);
      await loadWeek(wid);
    })();
    return () => { alive = false; };
  }, [open, name, subtitle]);

  const reservedByDay = useMemo(() => {
    const map = new Map();
    reservations.forEach((order) => {
      const dayKey = order.menuItemId?.dailyMenuId?.date || order.orderDate;
      const jalali = dayKey ? dayJalali(dayKey) : '';
      if (!jalali) return;
      if (!map.has(jalali)) map.set(jalali, []);
      map.get(jalali).push(order);
    });
    return map;
  }, [reservations]);

  async function handleReserve(menuItemId) {
    setBusyId(menuItemId);
    const ok = await reserve(menuItemId);
    setBusyId('');
    if (ok) loadWeek(weekId);
  }

  async function handleCancel(order) {
    setBusyId(order._id);
    const ok = await onCancel(order);
    setBusyId('');
    if (ok) loadWeek(weekId);
  }

  return (
    <>
      <div className="guest-drawer-overlay" hidden={!open} onClick={onClose} />
      <aside className={`guest-drawer${open ? ' is-open' : ''}`} aria-hidden={open ? 'false' : 'true'}>
        <div className="guest-drawer-header">
          <div>
            <div className="guest-drawer-title"><i className="fas fa-calendar-check" /> {title}</div>
            <div className="guest-reserve-name">{name || '—'}</div>
            {subtitle && <div className="guest-reserve-code">{subtitle}</div>}
          </div>
          <button type="button" className="btn-icon guest-drawer-close" onClick={onClose}><i className="fas fa-times" /></button>
        </div>
        <div className="guest-drawer-body">
          <div className="form-group">
            <label className="form-label">هفته</label>
            <select className="form-control" value={weekId} onChange={(e) => { setWeekId(e.target.value); loadWeek(e.target.value); }}>
              {weeks.map((w) => <option key={w._id} value={w._id}>{weekSelectLabel(w)}</option>)}
            </select>
          </div>
          {blockedReason && (
            <div className="weekly-reserve-blocked"><i className="fas fa-circle-info" /> {blockedReason}</div>
          )}
          <div>
            {!weekId ? (
              <div className="text-muted" style={{ fontSize: '.82rem' }}>هفته را انتخاب کنید</div>
            ) : loading ? (
              <div style={{ padding: 16, textAlign: 'center' }}><div className="spinner" /></div>
            ) : !menuDays.length ? (
              <div className="text-muted" style={{ fontSize: '.82rem' }}>روزی در منو نیست</div>
            ) : (
              menuDays.map((day) => {
                const jalali = dayJalali(day.date);
                const reserved = reservedByDay.get(jalali) || [];
                const reservedCats = new Set(reserved.map((o) => normalizeCategoryKey(o.foodCategory)));
                const items = blockedReason ? [] : (day.items || []).filter((item) => (
                  item.isAvailable !== false
                  && item.foodId?.isAvailable !== false
                  && !reservedCats.has(normalizeCategoryKey(item.foodId?.category))
                ));
                const showCategory = new Set((day.items || []).map((i) => normalizeCategoryKey(i.foodId?.category))).size > 1;
                return (
                  <div key={day._id} className="guest-day-card">
                    <div className="guest-day-title">{jalali}</div>
                    {reserved.map((order) => (
                      <div key={order._id} className="guest-day-reserved weekly-reserve-row">
                        <span>
                          <i className="fas fa-check-circle" /> {orderFoodName(order)}
                          {showCategory && <span className="weekly-reserve-cat"> · {categoryLabel(categories, order.foodCategory)}</span>}
                          {order.placedBy && <span className="weekly-reserve-by" title={order.placedBy.fullName || ''}>ثبت مدیر</span>}
                          {order.status === 'pending' && <span className="weekly-reserve-pending">در انتظار</span>}
                        </span>
                        {onCancel && !order.paymentLock && (
                          <button
                            type="button"
                            className="btn-icon weekly-reserve-cancel"
                            title="لغو این رزرو"
                            disabled={busyId === order._id}
                            onClick={() => handleCancel(order)}
                          >
                            <i className="fas fa-xmark" />
                          </button>
                        )}
                      </div>
                    ))}
                    {items.length > 0 && (
                      <div className="guest-food-actions">
                        {items.map((item) => {
                          const cap = Number(item.effectiveCapacity || 0);
                          const full = cap > 0 && Number(item.reservedCount || 0) >= cap;
                          const price = item.price ?? item.customPrice ?? item.foodId?.price ?? 0;
                          return (
                            <button
                              key={item._id}
                              type="button"
                              className="guest-food-btn"
                              disabled={full || !!busyId}
                              onClick={() => handleReserve(item._id)}
                            >
                              <span>
                                {item.foodId?.name || 'غذا'}
                                {showCategory && <span className="weekly-reserve-cat"> · {categoryLabel(categories, item.foodId?.category)}</span>}
                              </span>
                              <span>{full ? 'تکمیل' : money(price)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!reserved.length && !items.length && (
                      <div className="text-muted" style={{ fontSize: '.8rem' }}>{blockedReason ? 'رزرو نشده' : 'غذایی در منو نیست'}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
