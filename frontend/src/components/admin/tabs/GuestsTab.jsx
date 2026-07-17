import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import AdminSpinner from '../shared/AdminSpinner';
import EmptyState from '../shared/EmptyState';
import { useJalaliDatepicker } from '../../../hooks/useJalaliDatepicker';
import { faDigits, jdate, money } from '../../../utils/format';

function guestInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'م';
  if (parts.length === 1) return parts[0].slice(0, 1);
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
}

function weekSelectLabel(w) {
  const prefix = w.isActive ? 'فعال - ' : '';
  return `${prefix}${w.jalaliStart} تا ${w.jalaliEnd}`;
}

function dayJalali(dateValue) {
  return dateValue ? jdate(dateValue) : '';
}

export default function GuestsTab() {
  const { toast } = useToast();
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', fullName: '', guestType: 'temporary', department: '', status: 'active', notes: '', validUntil: '' });
  const [reserveGuest, setReserveGuest] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState('');
  const [menuDays, setMenuDays] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);

  useJalaliDatepicker(showForm && form.guestType === 'temporary');

  async function load() {
    setLoading(true);
    const data = await api('/api/admin/guests');
    setGuests(data.success ? data.data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    document.body.classList.toggle('guest-drawer-open', !!reserveGuest);
    return () => document.body.classList.remove('guest-drawer-open');
  }, [reserveGuest]);

  const filtered = useMemo(() => guests.filter((g) => {
    if (typeFilter && g.guestType !== typeFilter) return false;
    if (statusFilter && g.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const haystack = [g.fullName, g.guestCode, g.department, g.notes].map((v) => String(v || '').toLowerCase()).join(' ');
    return haystack.includes(q);
  }), [guests, search, typeFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: guests.length,
    permanent: guests.filter((g) => g.guestType === 'permanent').length,
    temporary: guests.filter((g) => g.guestType === 'temporary').length,
    active: guests.filter((g) => g.status === 'active').length,
  }), [guests]);

  function openAdd() {
    setForm({ id: '', fullName: '', guestType: 'temporary', department: '', status: 'active', notes: '', validUntil: '' });
    setShowForm(true);
  }

  function openEdit(g) {
    setForm({
      id: g._id,
      fullName: g.fullName || '',
      guestType: g.guestType || 'temporary',
      department: g.department || '',
      status: g.status || 'active',
      notes: g.notes || '',
      validUntil: g.validUntil ? jdate(g.validUntil) : '',
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    const payload = {
      fullName: form.fullName.trim(),
      guestType: form.guestType,
      department: form.department.trim() || undefined,
      status: form.status,
      notes: form.notes.trim() || undefined,
      validUntil: form.guestType === 'temporary' ? (form.validUntil.trim() || null) : null,
    };
    const data = form.id
      ? await api(`/api/admin/guests/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/admin/guests', { method: 'POST', body: JSON.stringify(payload) });
    if (data.success) { toast(data.message || 'ذخیره شد', 'success'); setShowForm(false); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  async function remove(g) {
    if (!(await confirmAction({
      title: 'حذف مهمان؟',
      text: `«${g.fullName}» (کد ${g.guestCode}) حذف می‌شود.`,
      confirmText: 'حذف',
      icon: 'warning',
    }))) return;
    const data = await api(`/api/admin/guests/${g._id}`, { method: 'DELETE' });
    if (data.success) {
      if (reserveGuest?._id === g._id) setReserveGuest(null);
      toast(data.message || 'مهمان حذف شد', 'success');
      load();
    } else toast(data.message || 'خطا', 'error');
  }

  async function openReserve(g) {
    setReserveGuest(g);
    const w = await api('/api/admin/weeks?noSync=true');
    const wl = w.success ? w.data : [];
    setWeeks(wl);
    const wid = wl.find((x) => x.isActive)?._id || wl[0]?._id || '';
    setWeekId(wid);
    if (wid) await loadReserveData(g._id, wid);
  }

  async function loadReserveData(guestId, wid) {
    if (!wid) {
      setMenuDays([]);
      setReservations([]);
      return;
    }
    setMenuLoading(true);
    const [menu, res] = await Promise.all([
      api(`/api/menu/weeks/${wid}`),
      api(`/api/admin/guests/${guestId}/reservations?weekId=${wid}`),
    ]);
    setMenuDays(menu.success ? menu.data?.days || [] : []);
    setReservations(res.success ? res.data?.orders || [] : []);
    setMenuLoading(false);
  }

  async function reserve(menuItemId) {
    const data = await api(`/api/admin/guests/${reserveGuest._id}/reserve`, { method: 'POST', body: JSON.stringify({ menuItemId }) });
    if (data.success) {
      toast(data.message || 'رزرو ثبت شد', 'success');
      loadReserveData(reserveGuest._id, weekId);
    } else toast(data.message || 'خطا', 'error');
  }

  const reservedByDay = useMemo(() => {
    const map = new Map();
    reservations.forEach((order) => {
      const dayKey = order.menuItemId?.dailyMenuId?.date || order.orderDate;
      const jalali = dayKey ? dayJalali(dayKey) : '';
      if (jalali) map.set(jalali, order);
    });
    return map;
  }, [reservations]);

  if (loading) return <AdminSpinner />;

  return (
    <section id="tab-guests" className="tab-pane active">
      <div className="guest-hub">
        <div className="guest-stats" id="guestStatsRow">
          <div className="guest-stat-card">
            <div className="guest-stat-icon total"><i className="fas fa-users" /></div>
            <div><div className="guest-stat-val" id="guestStatTotal">{faDigits(stats.total)}</div><div className="guest-stat-label">کل مهمان‌ها</div></div>
          </div>
          <div className="guest-stat-card">
            <div className="guest-stat-icon permanent"><i className="fas fa-id-card" /></div>
            <div><div className="guest-stat-val" id="guestStatPermanent">{faDigits(stats.permanent)}</div><div className="guest-stat-label">دائم</div></div>
          </div>
          <div className="guest-stat-card">
            <div className="guest-stat-icon temporary"><i className="fas fa-clock" /></div>
            <div><div className="guest-stat-val" id="guestStatTemporary">{faDigits(stats.temporary)}</div><div className="guest-stat-label">موقت</div></div>
          </div>
          <div className="guest-stat-card">
            <div className="guest-stat-icon active"><i className="fas fa-circle-check" /></div>
            <div><div className="guest-stat-val" id="guestStatActive">{faDigits(stats.active)}</div><div className="guest-stat-label">فعال</div></div>
          </div>
        </div>

        <div className="card guest-main-card">
          <div className="guest-card-head">
            <div>
              <div className="guest-card-title"><i className="fas fa-user-tag" /> مدیریت مهمان‌ها</div>
              <div className="guest-card-sub">ثبت مهمان با کد یکتا و رزرو هفتگی غذا از منوی فعال</div>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}><i className="fas fa-plus" /> مهمان جدید</button>
          </div>

          <div className="guest-toolbar">
            <div className="search-group guest-search">
              <i className="fas fa-search search-group-icon" />
              <input id="guestSearchInput" type="text" placeholder="جستجو نام، کد یا واحد..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-control guest-filter" id="guestTypeFilter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">همه انواع</option>
              <option value="permanent">دائم</option>
              <option value="temporary">موقت</option>
            </select>
            <select className="form-control guest-filter" id="guestStatusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همه وضعیت‌ها</option>
              <option value="active">فعال</option>
              <option value="inactive">غیرفعال</option>
            </select>
          </div>

          <div id="guestsTableWrap" className="guest-table-wrap">
            {!filtered.length ? (
              <EmptyState icon="fa-user-tag" title="مهمانی ثبت نشده است" desc="با دکمه «مهمان جدید» اولین مهمان را اضافه کنید." />
            ) : (
              <table className="table guest-table">
                <thead>
                  <tr>
                    <th>مهمان</th>
                    <th>کد</th>
                    <th>نوع</th>
                    <th>واحد</th>
                    <th>وضعیت</th>
                    <th style={{ textAlign: 'center' }}>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => (
                    <tr key={g._id}>
                      <td>
                        <div className="guest-row-name">
                          <span className="guest-row-avatar">{guestInitials(g.fullName)}</span>
                          <span>{g.fullName}</span>
                        </div>
                      </td>
                      <td><span className="guest-code-pill">{g.guestCode}</span></td>
                      <td><span className={`guest-type-chip ${g.guestType === 'permanent' ? 'permanent' : 'temporary'}`}>{g.guestType === 'permanent' ? 'دائم' : 'موقت'}</span></td>
                      <td>{g.department || '—'}</td>
                      <td><span className={`guest-status-chip ${g.status === 'active' ? 'active' : 'inactive'}`}>{g.status === 'active' ? 'فعال' : 'غیرفعال'}</span></td>
                      <td>
                        <div className="guest-actions">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => openReserve(g)} title="رزرو هفتگی"><i className="fas fa-calendar-check" /></button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(g)} title="ویرایش"><i className="fas fa-pen" /></button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(g)} title="حذف"><i className="fas fa-trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div id="guestFormOverlay" className="guest-form-overlay" hidden={!showForm}>
        <div className="guest-form-modal card">
          <div className="card-header">
            <div className="card-title" id="guestFormTitle">{form.id ? 'ویرایش مهمان' : 'ثبت مهمان'}</div>
            <button type="button" className="btn-icon" onClick={() => setShowForm(false)}><i className="fas fa-times" /></button>
          </div>
          <div className="card-body">
            <form id="guestForm" onSubmit={save}>
              <input type="hidden" id="editGuestId" value={form.id} readOnly />
              <div className="guest-form-grid">
                <div className="form-group">
                  <label className="form-label">نام مهمان *</label>
                  <input className="form-control" id="guest_fullName" required maxLength={120} placeholder="نام و نام خانوادگی" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">نوع مهمان</label>
                  <select className="form-control" id="guest_type" value={form.guestType} onChange={(e) => setForm({ ...form, guestType: e.target.value })}>
                    <option value="temporary">موقت</option>
                    <option value="permanent">دائم</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">واحد / بخش میزبان</label>
                  <input className="form-control" id="guest_department" maxLength={120} placeholder="مثال: پشتیبانی" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">وضعیت</label>
                  <select className="form-control" id="guest_status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                  </select>
                </div>
              </div>
              <div className="form-group" id="guest_valid_wrap" style={{ display: form.guestType === 'temporary' ? '' : 'none' }}>
                <label className="form-label">اعتبار تا (شمسی — برای مهمان موقت)</label>
                <input
                  className="form-control"
                  id="guest_validUntil"
                  data-jdp
                  data-jdp-only-date
                  autoComplete="off"
                  placeholder="مثال: ۱۴۰۴/۰۵/۳۰"
                  value={form.validUntil}
                  onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">یادداشت</label>
                <textarea className="form-control" id="guest_notes" rows={2} maxLength={500} placeholder="توضیح اختیاری" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="guest-form-actions">
                <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
                <button className="btn btn-outline" type="button" onClick={() => setShowForm(false)}>انصراف</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div id="guestReserveOverlay" className="guest-drawer-overlay" hidden={!reserveGuest} onClick={() => setReserveGuest(null)} />
      <aside className={`guest-drawer${reserveGuest ? ' is-open' : ''}`} id="guestReservePanel" aria-hidden={reserveGuest ? 'false' : 'true'}>
        <div className="guest-drawer-header">
          <div>
            <div className="guest-drawer-title"><i className="fas fa-calendar-check" /> رزرو هفتگی</div>
            <div className="guest-reserve-name" id="guestReserveName">{reserveGuest?.fullName || '—'}</div>
            <div className="guest-reserve-code" id="guestReserveCode">کد: {reserveGuest?.guestCode || '—'}</div>
          </div>
          <button type="button" className="btn-icon guest-drawer-close" onClick={() => setReserveGuest(null)}><i className="fas fa-times" /></button>
        </div>
        <div className="guest-drawer-body">
          <div className="form-group">
            <label className="form-label">هفته</label>
            <select className="form-control" id="guestReserveWeekSelect" value={weekId} onChange={(e) => { setWeekId(e.target.value); if (reserveGuest) loadReserveData(reserveGuest._id, e.target.value); }}>
              {weeks.map((w) => <option key={w._id} value={w._id}>{weekSelectLabel(w)}</option>)}
            </select>
          </div>
          <div id="guestReserveMenuWrap">
            {!weekId ? (
              <div className="text-muted" style={{ fontSize: '.82rem' }}>هفته را انتخاب کنید</div>
            ) : menuLoading ? (
              <div style={{ padding: 16, textAlign: 'center' }}><div className="spinner" /></div>
            ) : !menuDays.length ? (
              <div className="text-muted" style={{ fontSize: '.82rem' }}>روزی در منو نیست</div>
            ) : (
              menuDays.map((day) => {
                const jalali = dayJalali(day.date);
                const reserved = reservedByDay.get(jalali);
                if (reserved) {
                  const food = reserved.menuItemId?.foodId?.name
                    || (reserved.items || []).map((i) => i.foodId?.name).filter(Boolean).join('، ')
                    || 'رزرو شده';
                  return (
                    <div key={day._id} className="guest-day-card">
                      <div className="guest-day-title">{jalali}</div>
                      <div className="guest-day-reserved"><i className="fas fa-check-circle" /> {food}</div>
                    </div>
                  );
                }
                const items = (day.items || []).filter((item) => item.isAvailable !== false && item.foodId?.isAvailable !== false);
                if (!items.length) {
                  return (
                    <div key={day._id} className="guest-day-card">
                      <div className="guest-day-title">{jalali}</div>
                      <div className="text-muted" style={{ fontSize: '.8rem' }}>غذایی در منو نیست</div>
                    </div>
                  );
                }
                return (
                  <div key={day._id} className="guest-day-card">
                    <div className="guest-day-title">{jalali}</div>
                    <div className="guest-food-actions">
                      {items.map((item) => {
                        const full = Number(item.reservedCount || 0) >= Number(item.effectiveCapacity || 0) && Number(item.effectiveCapacity || 0) > 0;
                        const foodName = item.foodId?.name || 'غذا';
                        const price = item.price ?? item.customPrice ?? item.foodId?.price ?? 0;
                        return (
                          <button
                            key={item._id}
                            type="button"
                            className="guest-food-btn"
                            disabled={full}
                            onClick={() => reserve(item._id)}
                          >
                            <span>{foodName}</span>
                            <span>{full ? 'تکمیل' : money(price)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}
