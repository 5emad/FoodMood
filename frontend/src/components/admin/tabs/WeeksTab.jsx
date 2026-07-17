import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
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
  const [weeks, setWeeks] = useState([]);
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());
  const [openEditor, setOpenEditor] = useState(null);
  const [menuDays, setMenuDays] = useState([]);
  const [checked, setChecked] = useState({});
  const [menuLoading, setMenuLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [w, f] = await Promise.all([
      api('/api/admin/weeks?noSync=true'),
      api('/api/foods?includeInactive=true'),
    ]);
    const weekList = w.success ? w.data : [];
    setWeeks(weekList);
    setFoods(f.success ? f.data : []);
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

  async function createCurrent() {
    try {
      const data = await api('/api/admin/weeks/current', { method: 'POST', body: JSON.stringify({ count: 5 }) });
      if (data.success) {
        const n = Array.isArray(data.data) ? data.data.length : 0;
        toast(n ? `${n} هفته جاری/آینده آماده شد` : (data.message || 'هفته ساخته شد'), 'success');
        load();
      } else {
        toast(data.message || 'خطا در ساخت هفته', 'error');
      }
    } catch (err) {
      toast(err?.message || 'خطا در ساخت هفته جاری', 'error');
    }
  }

  async function activate(id) {
    const data = await api(`/api/admin/weeks/${id}/activate`, { method: 'POST' });
    if (data.success) { toast('هفته فعال شد', 'success'); load(); }
    else toast(data.message || 'خطا', 'error');
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
    const map = {};
    days.forEach((d) => {
      (d.items || []).forEach((item) => {
        map[`${d._id}:${item.foodId?._id || item.foodId}`] = item._id;
      });
    });
    setChecked(map);
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
  }

  async function saveMenu(weekId) {
    const original = {};
    menuDays.forEach((d) => {
      (d.items || []).forEach((item) => {
        original[`${d._id}:${item.foodId?._id || item.foodId}`] = item._id;
      });
    });
    let cancelledTotal = 0;
    for (const day of menuDays) {
      for (const food of foods) {
        const key = `${day._id}:${food._id}`;
        const was = original[key];
        const now = checked[key];
        if (!was && now) {
          await api('/api/admin/menu-items', { method: 'POST', body: JSON.stringify({ dailyMenuId: day._id, foodId: food._id, maxCapacity: 0 }) });
        } else if (was && !now) {
          const res = await api(`/api/admin/menu-items/${was}`, { method: 'DELETE' });
          if (res.success) {
            cancelledTotal += Number(res.cancelledCount || 0);
          } else {
            toast(res.message || 'حذف آیتم منو ناموفق بود', 'error');
          }
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

  const tree = new Map();
  weeks.forEach((w) => {
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
        sub="برای هر هفته منو تعریف کنید. با حذف یا عوض کردن غذا، سفارش‌های همان غذا خودکار لغو و از گزارش خارج می‌شوند."
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={createCurrent}><i className="fas fa-sync-alt" /> ساخت هفته جاری</button>}
      />
      <div id="weeksListWrap">
        {loading ? <AdminSpinner /> : !weeks.length ? (
          <div className="empty-state"><i className="fas fa-calendar-times" /><p>هیچ هفته‌ای تعریف نشده است.</p></div>
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
                            {hasActive && <span className="badge badge-success">هفته فعال</span>}
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
                                    {!w.isActive && (
                                      <button type="button" className="btn btn-success btn-sm" onClick={() => activate(w._id)}>
                                        <i className="fas fa-check-circle" /> فعال کردن
                                      </button>
                                    )}
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(w._id)}>
                                      <i className="fas fa-trash-alt" />
                                    </button>
                                  </div>
                                </div>
                                <div className="week-menu-editor" id={`weditor-${w._id}`} style={{ display: openEditor === w._id ? 'block' : 'none' }}>
                                  <div className="day-checkboxes" id={`wdays-${w._id}`}>
                                    {openEditor === w._id && menuLoading ? (
                                      <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner" /></div>
                                    ) : menuDays.map((day) => (
                                      <div key={day._id} className="day-box">
                                        <div className="day-box-head">{day.dayId?.name || ''} — {jdate(day.date)}</div>
                                        <div className="day-box-body" data-daily-menu-id={day._id}>
                                          {foods.map((food) => {
                                            const key = `${day._id}:${food._id}`;
                                            return (
                                              <label key={food._id} className="food-check-label">
                                                <input type="checkbox" checked={!!checked[key]} onChange={() => toggleCheck(day._id, food._id)} />
                                                {' '}{food.name}
                                              </label>
                                            );
                                          })}
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
