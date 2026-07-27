import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import { readJalaliInputValue, useJalaliDatepicker } from '../../../hooks/useJalaliDatepicker';
import { groupItemsByCategory } from '../../../lib/foodCategories';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import { faDigits, faYear, jdate, jdateParts } from '../../../utils/format';

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function jalaliYearMonth(dateValue) {
  const { year, month } = jdateParts(dateValue);
  return { year, month };
}

function weekDateLabel(w) {
  return `${w.jalaliStart} تا ${w.jalaliEnd}`;
}

export default function WeeksTab() {
  const { toast } = useToast();
  const currentJYear = jdateParts(new Date()).year;
  const [weeks, setWeeks] = useState([]);
  const [foods, setFoods] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());
  const [openEditor, setOpenEditor] = useState(null);
  const [menuDays, setMenuDays] = useState([]);
  const [checked, setChecked] = useState({});
  const [capacities, setCapacities] = useState({});
  const [defaultCapacity, setDefaultCapacity] = useState(20);
  const [menuLoading, setMenuLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filterYear, setFilterYear] = useState(currentJYear);
  const [weekForm, setWeekForm] = useState({
    jalaliYear: currentJYear,
    startDate: '',
    endDate: '',
    weekNumber: '',
    name: '',
    activate: false,
  });
  const [createBusy, setCreateBusy] = useState(false);
  const startDateRef = useRef(null);
  const endDateRef = useRef(null);

  useJalaliDatepicker(showCreate);

  async function load() {
    setLoading(true);
    const [w, f, c] = await Promise.all([
      api('/api/admin/weeks?noSync=true'),
      api('/api/foods?includeInactive=true'),
      api('/api/foods/categories'),
    ]);
    const weekList = w.success ? w.data : [];
    setWeeks(weekList);
    setFoods(f.success ? f.data : []);
    setCategories(c.success ? (c.data || []) : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!weeks.length) return;
    setExpanded((prev) => {
      if (prev.size) return prev;
      const anchor = weeks.find((x) => x.isActive)?.startDate || new Date();
      const { year, month } = jalaliYearMonth(anchor);
      return new Set([`y${year}`, `y${year}m${month}`]);
    });
  }, [weeks]);

  async function createWeekManual(e) {
    e.preventDefault();
    const startDate = readJalaliInputValue(startDateRef.current);
    const endDate = readJalaliInputValue(endDateRef.current);
    if (!startDate || !endDate) {
      toast('تاریخ شروع و پایان را انتخاب کنید', 'error');
      return;
    }
    setCreateBusy(true);
    try {
      const payload = {
        startDate,
        endDate,
        isActive: weekForm.activate,
      };
      if (weekForm.weekNumber) payload.weekNumber = Number(weekForm.weekNumber);
      if (weekForm.name.trim()) payload.name = weekForm.name.trim();

      const data = await api('/api/admin/weeks', { method: 'POST', body: JSON.stringify(payload) });
      if (data.success) {
        toast(data.message || 'هفته ایجاد شد', 'success');
        setShowCreate(false);
        setWeekForm({
          jalaliYear: filterYear,
          startDate: '',
          endDate: '',
          weekNumber: '',
          name: '',
          activate: false,
        });
        if (data.data?.startDate) {
          const y = jdateParts(data.data.startDate).year;
          setFilterYear(y);
        }
        load();
      } else {
        toast(data.message || 'خطا در ایجاد هفته', 'error');
      }
    } catch (err) {
      toast(err?.message || 'خطا در ایجاد هفته', 'error');
    } finally {
      setCreateBusy(false);
    }
  }

  async function activate(id) {
    try {
      const data = await api(`/api/admin/weeks/${id}/activate`, { method: 'POST', body: JSON.stringify({}) });
      if (data.success) { toast(data.message || 'هفته فعال شد', 'success'); load(); }
      else toast(data.message || 'خطا در فعال‌سازی هفته', 'error');
    } catch (err) {
      toast(err?.message || 'خطا در فعال‌سازی هفته', 'error');
    }
  }

  async function deactivate(id) {
    try {
      const data = await api(`/api/admin/weeks/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ deactivate: true }),
      });
      if (data.success) { toast(data.message || 'هفته غیرفعال شد', 'success'); load(); }
      else toast(data.message || 'خطا در غیرفعال‌سازی هفته', 'error');
    } catch (err) {
      toast(err?.message || 'خطا در غیرفعال‌سازی هفته', 'error');
    }
  }

  async function remove(id) {
    if (!(await confirmAction({ title: 'حذف کامل هفته؟', text: 'تمام منوها و سفارش‌های وابسته به این هفته حذف می‌شوند.', confirmText: 'حذف هفته', icon: 'warning' }))) return;
    const data = await api(`/api/admin/weeks/${id}`, { method: 'DELETE' });
    if (data.success) { toast('حذف شد', 'success'); setOpenEditor(null); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  async function loadMenu(weekId) {
    setMenuLoading(true);
    const data = await api(`/api/menu/weeks/${weekId}`);
    const days = data.success ? data.data?.days || [] : [];
    setMenuDays(days);
    setDefaultCapacity(Number(data.data?.settings?.defaultMenuItemCapacity ?? 20));
    const map = {};
    const capMap = {};
    days.forEach((d) => {
      (d.items || []).forEach((item) => {
        const foodId = item.foodId?._id || item.foodId;
        const key = `${d._id}:${foodId}`;
        map[key] = item._id;
        capMap[key] = Number(item.maxCapacity) > 0
          ? Number(item.maxCapacity)
          : Number(item.effectiveCapacity || data.data?.settings?.defaultMenuItemCapacity || 20);
      });
    });
    setChecked(map);
    setCapacities(capMap);
    setMenuLoading(false);
  }

  async function toggleEditor(weekId) {
    if (openEditor === weekId) {
      setOpenEditor(null);
      return;
    }
    setOpenEditor(weekId);
    await loadMenu(weekId);
  }

  function toggleCheck(dayId, foodId) {
    const key = `${dayId}:${foodId}`;
    setChecked((c) => {
      const next = { ...c };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
    setCapacities((c) => {
      const next = { ...c };
      if (next[key] == null) next[key] = defaultCapacity;
      return next;
    });
  }

  function setCapacity(dayId, foodId, value) {
    const key = `${dayId}:${foodId}`;
    setCapacities((c) => ({ ...c, [key]: value }));
  }

  async function saveMenu(weekId) {
    const original = {};
    const originalCap = {};
    menuDays.forEach((d) => {
      (d.items || []).forEach((item) => {
        const foodId = item.foodId?._id || item.foodId;
        const key = `${d._id}:${foodId}`;
        original[key] = item._id;
        originalCap[key] = Number(item.maxCapacity || 0);
      });
    });
    let cancelledTotal = 0;
    for (const day of menuDays) {
      for (const food of foods) {
        const key = `${day._id}:${food._id}`;
        const was = original[key];
        const now = checked[key];
        const capVal = Math.max(Number(capacities[key] || 0), 0);
        // 0 = inherit default; positive = override for this day/food
        const maxCapacity = capVal === defaultCapacity ? 0 : capVal;
        if (!was && now) {
          await api('/api/admin/menu-items', {
            method: 'POST',
            body: JSON.stringify({ dailyMenuId: day._id, foodId: food._id, maxCapacity }),
          });
        } else if (was && !now) {
          const res = await api(`/api/admin/menu-items/${was}`, { method: 'DELETE' });
          if (res.success) {
            cancelledTotal += Number(res.cancelledCount || 0);
          } else {
            toast(res.message || 'حذف آیتم منو ناموفق بود', 'error');
          }
        } else if (was && now && Number(originalCap[key] || 0) !== Number(maxCapacity)) {
          await api(`/api/admin/menu-items/${was}`, {
            method: 'PUT',
            body: JSON.stringify({ maxCapacity }),
          });
        }
      }
    }
    if (cancelledTotal > 0) {
      toast(`منو ذخیره شد. ${cancelledTotal} سفارش مربوط به غذاهای حذف‌شده لغو شد و از گزارش خارج می‌شود.`, 'success');
    } else {
      toast('منو با موفقیت ذخیره شد', 'success');
    }
    await loadMenu(weekId);
  }

  function toggleNode(key) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const filteredWeeks = useMemo(() => {
    if (!filterYear) return weeks;
    return weeks.filter((w) => jdateParts(w.startDate).year === Number(filterYear));
  }, [weeks, filterYear]);

  const foodsByCategory = useMemo(
    () => groupItemsByCategory(foods, (food) => food.category, categories),
    [foods, categories],
  );

  const availableYears = useMemo(() => {
    const years = new Set(weeks.map((w) => jdateParts(w.startDate).year));
    years.add(currentJYear);
    years.add(Number(filterYear));
    return [...years].sort((a, b) => b - a);
  }, [weeks, currentJYear, filterYear]);

  const tree = new Map();
  filteredWeeks.forEach((w) => {
    const { year, month } = jalaliYearMonth(w.startDate);
    if (!tree.has(year)) tree.set(year, new Map());
    const months = tree.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(w);
  });

  return (
    <section id="tab-weeks" className="tab-pane active">
      <SectionHeader
        title="مدیریت هفته‌ها"
        sub="هفته را با سال و بازه زمانی دلخواه تعریف کنید و برای هر هفته منو بچینید."
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
            <i className="fas fa-plus" /> {showCreate ? 'بستن فرم' : 'ایجاد هفته جدید'}
          </button>
        )}
      />

      {showCreate && (
        <div className="card">
          <div className="card-header"><div className="card-title">ایجاد هفته با بازه دلخواه</div></div>
          <div className="card-body">
            <form className="week-create-form" onSubmit={createWeekManual}>
              <div className="week-create-grid">
                <label className="form-label">
                  <span>سال شمسی</span>
                  <input
                    className="form-control"
                    type="number"
                    min={1300}
                    max={1500}
                    value={weekForm.jalaliYear}
                    onChange={(e) => {
                      const y = Number(e.target.value) || currentJYear;
                      setWeekForm((f) => ({ ...f, jalaliYear: y }));
                      setFilterYear(y);
                    }}
                  />
                </label>
                <label className="form-label">
                  <span>تاریخ شروع</span>
                  <input
                    key="week-start-jdp"
                    ref={startDateRef}
                    className="form-control"
                    data-jdp
                    data-jdp-only-date
                    autoComplete="off"
                    placeholder="مثال: ۱۴۰۴/۰۱/۰۱"
                    defaultValue=""
                    required
                  />
                </label>
                <label className="form-label">
                  <span>تاریخ پایان</span>
                  <input
                    key="week-end-jdp"
                    ref={endDateRef}
                    className="form-control"
                    data-jdp
                    data-jdp-only-date
                    autoComplete="off"
                    placeholder="مثال: ۱۴۰۴/۰۱/۰۷"
                    defaultValue=""
                    required
                  />
                </label>
                <label className="form-label">
                  <span>شماره هفته (اختیاری)</span>
                  <input
                    className="form-control"
                    type="number"
                    min={1}
                    placeholder="خودکار"
                    value={weekForm.weekNumber}
                    onChange={(e) => setWeekForm((f) => ({ ...f, weekNumber: e.target.value }))}
                  />
                </label>
                <label className="form-label">
                  <span>عنوان (اختیاری)</span>
                  <input
                    className="form-control"
                    placeholder="مثال: هفته اول"
                    value={weekForm.name}
                    onChange={(e) => setWeekForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label className="form-label week-create-check">
                  <input
                    type="checkbox"
                    checked={weekForm.activate}
                    onChange={(e) => setWeekForm((f) => ({ ...f, activate: e.target.checked }))}
                  />
                  {' '}فعال‌سازی همزمان این هفته
                </label>
              </div>
              <p className="form-hint" style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '.85rem' }}>
                بازه حداکثر ۷ روز. تاریخ‌ها را با تقویم شمسی انتخاب کنید.
              </p>
              <div style={{ marginTop: 12, textAlign: 'left' }}>
                <button type="submit" className="btn btn-primary" disabled={createBusy}>
                  <i className="fas fa-save" /> {createBusy ? 'در حال ایجاد...' : 'ثبت هفته'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="week-year-filter" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700 }}>نمایش سال:</span>
          <select className="form-control" style={{ width: 140 }} value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{faYear(y)}</option>)}
          </select>
        </label>
      </div>

      <div id="weeksListWrap">
        {loading ? <AdminSpinner /> : !filteredWeeks.length ? (
          <div className="empty-state"><i className="fas fa-calendar-times" /><p>برای این سال هفته‌ای تعریف نشده است.</p></div>
        ) : (
          <div className="week-tree">
            {[...tree.keys()].sort((a, b) => b - a).map((year) => {
              const yearKey = `y${year}`;
              const months = tree.get(year);
              const yearCount = [...months.values()].reduce((sum, list) => sum + list.length, 0);
              const yearOpen = expanded.has(yearKey);
              return (
                <div key={year} className={`tree-year${yearOpen ? ' open' : ''}`} id={`node-${yearKey}`}>
                  <button type="button" className="tree-node-head tree-year-head" onClick={() => toggleNode(yearKey)}>
                    <i className="fas fa-chevron-left tree-arrow" />
                    <i className="fas fa-calendar" />
                    <span>سال {faYear(year)}</span>
                    <span className="tree-count">{faDigits(yearCount)} هفته</span>
                  </button>
                  <div className="tree-children">
                    {[...months.keys()].sort((a, b) => a - b).map((month) => {
                      const monthKey = `y${year}m${month}`;
                      const list = months.get(month).slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
                      const hasActive = list.some((w) => w.isActive);
                      const monthOpen = expanded.has(monthKey);
                      return (
                        <div key={monthKey} className={`tree-month${monthOpen ? ' open' : ''}`} id={`node-${monthKey}`}>
                          <button type="button" className="tree-node-head tree-month-head" onClick={() => toggleNode(monthKey)}>
                            <i className="fas fa-chevron-left tree-arrow" />
                            <i className="far fa-calendar-alt" />
                            <span>{MONTHS[month - 1] || month}</span>
                            <span className="tree-count">{faDigits(list.length)} هفته</span>
                            {hasActive && <span className="badge badge-success">دارای هفته فعال</span>}
                          </button>
                          <div className="tree-children tree-weeks">
                            {list.map((w) => (
                              <div key={w._id} className={`week-card${w.isActive ? ' is-active' : ''}`} id={`wcard-${w._id}`}>
                                <div className="week-card-head">
                                  <div className="week-card-meta">
                                    <span className="week-card-name">{weekDateLabel(w)}</span>
                                    {w.isActive && <span className="badge badge-success"><i className="fas fa-circle" style={{ fontSize: '.5rem' }} /> فعال</span>}
                                  </div>
                                  <div className="week-card-actions">
                                    <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleEditor(w._id)}>
                                      <i className="fas fa-utensils" /> مدیریت غذاها
                                    </button>
                                    {!w.isActive ? (
                                      <button type="button" className="btn btn-success btn-sm" onClick={() => activate(w._id)}>
                                        <i className="fas fa-check-circle" /> فعال کردن
                                      </button>
                                    ) : (
                                      <button type="button" className="btn btn-outline btn-sm" onClick={() => deactivate(w._id)}>
                                        <i className="fas fa-pause-circle" /> غیرفعال
                                      </button>
                                    )}
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(w._id)}>
                                      <i className="fas fa-trash-alt" />
                                    </button>
                                  </div>
                                </div>
                                <div className="week-menu-editor" id={`weditor-${w._id}`} style={{ display: openEditor === w._id ? 'block' : 'none' }}>
                                  <p className="section-sub" style={{ marginBottom: 12 }}>
                                    ظرفیت هر غذا برای هر روز قابل تنظیم است. پیش‌فرض سامانه: {faDigits(defaultCapacity)}
                                  </p>
                                  <div className="day-checkboxes" id={`wdays-${w._id}`}>
                                    {openEditor === w._id && menuLoading ? (
                                      <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner" /></div>
                                    ) : menuDays.map((day) => (
                                      <div key={day._id} className="day-box">
                                        <div className="day-box-head">{day.dayId?.name || ''} — {jdate(day.date)}</div>
                                        <div className="day-box-body" data-daily-menu-id={day._id}>
                                          {foodsByCategory.map((group) => (
                                            <div key={group.key} className="week-food-cat-block">
                                              <div className="week-food-cat-title">{group.name}</div>
                                              {group.items.map((food) => {
                                                const key = `${day._id}:${food._id}`;
                                                const isOn = !!checked[key];
                                                return (
                                                  <div key={food._id} className={`food-check-row${isOn ? ' is-on' : ''}`}>
                                                    <label className="food-check-label">
                                                      <input type="checkbox" checked={isOn} onChange={() => toggleCheck(day._id, food._id)} />
                                                      {' '}{food.name}
                                                    </label>
                                                    {isOn && (
                                                      <label className="food-cap-label">
                                                        <span>ظرفیت</span>
                                                        <input
                                                          type="number"
                                                          min={1}
                                                          className="food-cap-input"
                                                          dir="ltr"
                                                          value={capacities[key] ?? defaultCapacity}
                                                          onChange={(e) => setCapacity(day._id, food._id, e.target.value)}
                                                          title="ظرفیت این غذا در این روز"
                                                        />
                                                      </label>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ textAlign: 'left', marginTop: 16 }}>
                                    <button type="button" className="btn btn-primary" onClick={() => saveMenu(w._id)}>
                                      <i className="fas fa-save" /> ذخیره تغییرات منو
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
