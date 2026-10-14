import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import { groupItemsByCategory } from '../../../lib/foodCategories';
import SectionHeader from '../shared/SectionHeader';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import EmptyState from '../shared/EmptyState';
import { faDigits, money, tomanLabel } from '../../../utils/format';

const PAGE_SIZE = 20;

function isInactive(food) {
  return food.status === 'inactive' || food.isAvailable === false;
}

export default function FoodsTab() {
  const { toast } = useToast();
  const [foods, setFoods] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [form, setForm] = useState({ name: '', price: '', category: 'lunch' });
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [catForm, setCatForm] = useState({ name: '' });
  const [catBusy, setCatBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const catLabel = (key) => categories.find((c) => c.key === key)?.name || key;
  const defaultCategory = categories[0]?.key || 'lunch';

  const visibleFoods = useMemo(() => {
    const q = search.trim();
    if (!q) return foods;
    return foods.filter((f) => String(f.name || '').includes(q)
      || String(categories.find((c) => c.key === f.category)?.name || f.category || '').includes(q));
  }, [foods, search, categories]);

  const foodsByCategory = useMemo(
    () => groupItemsByCategory(visibleFoods, (food) => food.category, categories),
    [visibleFoods, categories],
  );

  const pageIds = visibleFoods.map((f) => String(f._id));
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));
  const selectionCount = allMatching ? pagination.total : selected.size;

  async function loadCategories() {
    const data = await api('/api/foods/categories?includeInactive=true');
    const list = data.success ? data.data : [];
    setCategories(list);
    return list;
  }

  async function load(page = 1) {
    setLoading(true);
    const [foodData] = await Promise.all([
      api(`/api/foods?includeInactive=true&page=${page}&limit=${PAGE_SIZE}`),
      loadCategories(),
    ]);
    setFoods(foodData.success ? foodData.data : []);
    setPagination(foodData.pagination || { page, totalPages: 1, total: (foodData.data || []).length });
    setLoading(false);
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!categories.length) return;
    setForm((prev) => (categories.some((c) => c.key === prev.category) ? prev : { ...prev, category: defaultCategory }));
  }, [categories, defaultCategory]);

  useEffect(() => {
    if (!edit) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setEdit(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [edit]);

  async function addCategory(e) {
    e.preventDefault();
    const name = catForm.name.trim();
    if (!name) return;
    setCatBusy(true);
    const data = await api('/api/foods/categories', { method: 'POST', body: JSON.stringify({ name }) });
    setCatBusy(false);
    if (data.success) {
      toast('دسته اضافه شد', 'success');
      setCatForm({ name: '' });
      await loadCategories();
    } else toast(data.message || 'خطا', 'error');
  }

  async function removeCategory(cat) {
    if (!(await confirmAction({ title: 'حذف دسته؟', text: `«${cat.name}» حذف می‌شود.`, confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/foods/categories/${encodeURIComponent(cat._id)}`, { method: 'DELETE' });
    if (data.success) {
      toast('دسته حذف شد', 'success');
      await loadCategories();
    } else toast(data.message || 'خطا', 'error');
  }

  async function addFood(e) {
    e.preventDefault();
    if (!form.name.trim() || form.price === '') {
      toast('نام و قیمت غذا را وارد کنید', 'error');
      return;
    }
    setAdding(true);
    const data = await api('/api/foods', {
      method: 'POST',
      body: JSON.stringify({ name: form.name.trim(), price: form.price, category: form.category || defaultCategory }),
    });
    setAdding(false);
    if (data.success) {
      toast('غذا اضافه شد', 'success');
      setForm({ name: '', price: '', category: form.category || defaultCategory });
      load(pagination.page);
    } else toast(data.message || 'خطا', 'error');
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true);
    const data = await api(`/api/foods/${encodeURIComponent(edit._id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: edit.name,
        price: edit.price,
        category: edit.category,
        status: edit.status === 'inactive' ? 'inactive' : 'active',
        isAvailable: edit.status !== 'inactive',
      }),
    });
    setSaving(false);
    if (data.success) { toast('تغییرات ذخیره شد', 'success'); setEdit(null); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  async function remove(food) {
    if (!(await confirmAction({ title: 'حذف غذا؟', text: `«${food.name}» برای همیشه حذف می‌شود.`, confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/foods/${encodeURIComponent(food._id)}`, { method: 'DELETE' });
    if (data.success) {
      toast('حذف شد', 'success');
      setSelected((s) => { const n = new Set(s); n.delete(String(food._id)); return n; });
      load(pagination.page);
    } else toast(data.message || 'خطا', 'error');
  }

  function toggleOne(id) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function togglePage() {
    if (allMatching) { clearSelection(); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleGroup(items) {
    setAllMatching(false);
    const ids = items.map((f) => String(f._id));
    const all = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function bulkDelete() {
    if (!selectionCount) return;
    const text = allMatching
      ? `همه ${faDigits(pagination.total)} غذا حذف می‌شوند. غذاهایی که در منوی هفتگی استفاده شده‌اند حذف نمی‌شوند.`
      : `${faDigits(selected.size)} غذای انتخاب‌شده حذف می‌شوند. غذاهایی که در منوی هفتگی استفاده شده‌اند حذف نمی‌شوند.`;
    if (!(await confirmAction({ title: 'حذف گروهی غذاها؟', text, confirmText: 'حذف', icon: 'warning' }))) return;
    setBulkBusy(true);
    const data = await api('/api/foods/bulk-delete', {
      method: 'POST',
      body: JSON.stringify(allMatching ? { all: true } : { ids: [...selected] }),
    });
    setBulkBusy(false);
    if (!data.success) {
      toast(data.message || 'خطا در حذف گروهی', 'error');
      return;
    }
    const skipped = data.data?.skipped || [];
    toast(data.message || 'حذف انجام شد', skipped.length ? 'warning' : 'success');
    setAllMatching(false);
    setSelected(new Set(skipped.map((s) => s.id)));
    const left = Math.max(0, pagination.total - Number(data.data?.deleted || 0));
    load(Math.min(pagination.page, Math.max(1, Math.ceil(left / PAGE_SIZE))));
  }

  async function bulkStatus(status) {
    if (!selected.size || allMatching) return;
    setBulkBusy(true);
    const data = await api('/api/foods/bulk-status', {
      method: 'POST',
      body: JSON.stringify({ ids: [...selected], status }),
    });
    setBulkBusy(false);
    if (data.success) {
      toast(data.message || 'انجام شد', 'success');
      clearSelection();
      load(pagination.page);
    } else toast(data.message || 'خطا', 'error');
  }

  function goPage(page) {
    if (allMatching) clearSelection();
    load(page);
  }

  return (
    <section id="tab-foods" className="tab-pane active">
      <SectionHeader title="غذاها" sub="تعریف دسته‌بندی و غذاهای قابل استفاده در منوی هفته" />

      <div className="adm-grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-plus-circle" /> افزودن غذای جدید</div>
          </div>
          <div className="card-body">
            <form className="adm-form-grid" onSubmit={addFood}>
              <label className="adm-field adm-field--wide">
                <span>نام غذا</span>
                <input className="form-control" placeholder="مثلاً چلوکباب کوبیده" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </label>
              <label className="adm-field">
                <span>قیمت ({tomanLabel()})</span>
                <input className="form-control" inputMode="numeric" dir="ltr" placeholder="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d۰-۹,]/g, '') })} required />
              </label>
              <label className="adm-field">
                <span>دسته</span>
                <select className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </label>
              <div className="adm-form-actions">
                <button className="btn btn-primary" type="submit" disabled={adding}>
                  <i className={`fas ${adding ? 'fa-circle-notch fa-spin' : 'fa-plus'}`} /> افزودن غذا
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><i className="fas fa-tags" /> دسته‌بندی غذا</div>
          </div>
          <div className="card-body">
            <form className="adm-inline" onSubmit={addCategory}>
              <input className="form-control" placeholder="نام دسته جدید (مثلاً دسر)" value={catForm.name} maxLength={40} onChange={(e) => setCatForm({ name: e.target.value })} required />
              <button className="btn btn-primary" type="submit" disabled={catBusy}><i className="fas fa-folder-plus" /> افزودن</button>
            </form>
            <div className="adm-chips">
              {categories.map((cat) => (
                <span key={cat._id} className="adm-chip">
                  {cat.name}
                  <button type="button" className="adm-chip-x" title={`حذف دسته ${cat.name}`} aria-label={`حذف دسته ${cat.name}`} onClick={() => removeCategory(cat)}>
                    <i className="fas fa-times" />
                  </button>
                </span>
              ))}
              {!categories.length && <span className="adm-muted">هنوز دسته‌ای تعریف نشده</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card adm-table-card">
        <div className="adm-toolbar">
          <div className="adm-toolbar-title">
            <i className="fas fa-utensils" /> فهرست غذاها
            <span className="adm-count">{faDigits(pagination.total || 0)}</span>
          </div>
          <div className="adm-search">
            <i className="fas fa-search" aria-hidden="true" />
            <input className="form-control" placeholder="جستجو در این صفحه…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="جستجوی غذا" />
          </div>
        </div>

        {selectionCount > 0 && (
          <div className="adm-bulkbar" role="region" aria-label="عملیات گروهی">
            <span className="adm-bulkbar-count">
              <i className="fas fa-check-square" /> {faDigits(selectionCount)} غذا انتخاب شده
              {allMatching && <span className="adm-muted"> (همه صفحات)</span>}
            </span>
            {allPageSelected && !allMatching && pagination.total > pageIds.length && !search && (
              <button type="button" className="adm-link-btn" onClick={() => setAllMatching(true)}>
                انتخاب همه {faDigits(pagination.total)} غذا
              </button>
            )}
            <div className="adm-bulkbar-actions">
              {!allMatching && (
                <>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => bulkStatus('active')} disabled={bulkBusy}><i className="fas fa-toggle-on" /> فعال‌سازی</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => bulkStatus('inactive')} disabled={bulkBusy}><i className="fas fa-toggle-off" /> غیرفعال‌سازی</button>
                </>
              )}
              <button type="button" className="btn btn-danger btn-sm" onClick={bulkDelete} disabled={bulkBusy}>
                <i className={`fas ${bulkBusy ? 'fa-circle-notch fa-spin' : 'fa-trash'}`} /> حذف انتخاب‌شده‌ها
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={clearSelection} disabled={bulkBusy}>لغو انتخاب</button>
            </div>
          </div>
        )}

        <div className="table-wrap">
          {loading ? <AdminSpinner /> : (
            visibleFoods.length === 0 ? (
              <EmptyState icon="fa-utensils" title={search ? 'غذایی با این عبارت پیدا نشد' : 'هنوز غذایی تعریف نشده است'} />
            ) : (
              <table className="table adm-table" id="foodsTable">
                <thead>
                  <tr>
                    <th className="adm-col-check">
                      <input
                        type="checkbox"
                        className="adm-check"
                        checked={allPageSelected || allMatching}
                        ref={(el) => { if (el) el.indeterminate = !allPageSelected && somePageSelected && !allMatching; }}
                        onChange={togglePage}
                        aria-label="انتخاب همه غذاهای این صفحه"
                      />
                    </th>
                    <th>نام</th>
                    <th>دسته</th>
                    <th>قیمت</th>
                    <th>وضعیت</th>
                    <th className="adm-col-actions">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {foodsByCategory.flatMap((group) => {
                    const groupIds = group.items.map((f) => String(f._id));
                    const groupAll = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
                    return [
                      <tr key={`cat-${group.key}`} className="adm-group-row">
                        <td className="adm-col-check">
                          <input type="checkbox" className="adm-check" checked={groupAll || allMatching} onChange={() => toggleGroup(group.items)} aria-label={`انتخاب همه غذاهای ${group.name}`} />
                        </td>
                        <td colSpan={5}>
                          {group.name}
                          <span className="adm-group-count">{faDigits(group.items.length)} غذا</span>
                        </td>
                      </tr>,
                      ...group.items.map((f) => {
                        const id = String(f._id);
                        const checked = allMatching || selected.has(id);
                        return (
                          <tr key={id} className={checked ? 'is-selected' : ''}>
                            <td className="adm-col-check">
                              <input type="checkbox" className="adm-check" checked={checked} onChange={() => toggleOne(id)} aria-label={`انتخاب ${f.name}`} />
                            </td>
                            <td className="adm-strong">{f.name}</td>
                            <td><span className="badge badge-primary">{catLabel(f.category)}</span></td>
                            <td className="adm-num">{money(f.price)}</td>
                            <td>
                              {isInactive(f)
                                ? <span className="adm-status adm-status--off">غیرفعال</span>
                                : <span className="adm-status adm-status--on">فعال</span>}
                            </td>
                            <td className="adm-col-actions">
                              <div className="adm-row-actions">
                                <button type="button" className="adm-icon-btn" onClick={() => setEdit({ ...f, status: isInactive(f) ? 'inactive' : 'active' })} title="ویرایش" aria-label={`ویرایش ${f.name}`}><i className="fas fa-pen" /></button>
                                <button type="button" className="adm-icon-btn adm-icon-btn--danger" onClick={() => remove(f)} title="حذف" aria-label={`حذف ${f.name}`}><i className="fas fa-trash" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
        <div id="foodsPagination"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPage={goPage} /></div>
      </div>

      {edit && (
        <div className="adm-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
          <div className="adm-modal" role="dialog" aria-modal="true" aria-labelledby="foodEditTitle">
            <div className="adm-modal-head">
              <h3 id="foodEditTitle"><i className="fas fa-pen" /> ویرایش غذا</h3>
              <button type="button" className="adm-icon-btn" onClick={() => setEdit(null)} aria-label="بستن"><i className="fas fa-times" /></button>
            </div>
            <form onSubmit={saveEdit}>
              <div className="adm-modal-body adm-form-grid">
                <label className="adm-field adm-field--wide">
                  <span>نام غذا</span>
                  <input className="form-control" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required autoFocus />
                </label>
                <label className="adm-field">
                  <span>قیمت ({tomanLabel()})</span>
                  <input className="form-control" inputMode="numeric" dir="ltr" value={edit.price ?? ''} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^\d۰-۹,]/g, '') })} required />
                </label>
                <label className="adm-field">
                  <span>دسته</span>
                  <select className="form-control" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                    {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </label>
                <label className="adm-field">
                  <span>وضعیت</span>
                  <select className="form-control" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                  </select>
                </label>
              </div>
              <div className="adm-modal-foot">
                <button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>انصراف</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <i className={`fas ${saving ? 'fa-circle-notch fa-spin' : 'fa-save'}`} /> ذخیره
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
