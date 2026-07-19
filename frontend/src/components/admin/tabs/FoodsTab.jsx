import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';
import { money, tomanLabel } from '../../../utils/format';

export default function FoodsTab() {
  const { toast } = useToast();
  const [foods, setFoods] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [form, setForm] = useState({ name: '', price: '', category: 'lunch', isType1: false });
  const [edit, setEdit] = useState(null);
  const [catForm, setCatForm] = useState({ name: '' });
  const [catBusy, setCatBusy] = useState(false);

  const catLabel = (key) => categories.find((c) => c.key === key)?.name || key;
  const defaultCategory = categories[0]?.key || 'lunch';

  async function loadCategories() {
    const data = await api('/api/foods/categories?includeInactive=true');
    const list = data.success ? data.data : [];
    setCategories(list);
    return list;
  }

  async function load(page = 1) {
    setLoading(true);
    const [foodData] = await Promise.all([
      api(`/api/foods?includeInactive=true&page=${page}&limit=20`),
      loadCategories(),
    ]);
    setFoods(foodData.success ? foodData.data : []);
    setPagination(foodData.pagination || { page, totalPages: 1, total: 0 });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!categories.length) return;
    setForm((prev) => (categories.some((c) => c.key === prev.category) ? prev : { ...prev, category: defaultCategory }));
  }, [categories, defaultCategory]);

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
    const data = await api(`/api/foods/categories/${cat._id}`, { method: 'DELETE' });
    if (data.success) {
      toast('دسته حذف شد', 'success');
      await loadCategories();
    } else toast(data.message || 'خطا', 'error');
  }

  async function addFood(e) {
    e.preventDefault();
    const data = await api('/api/foods', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        price: Number(form.price),
        category: form.category || defaultCategory,
        isType1: !!form.isType1,
      }),
    });
    if (data.success) {
      toast('غذا اضافه شد', 'success');
      setForm({ name: '', price: '', category: defaultCategory, isType1: false });
      load(pagination.page);
    } else toast(data.message || 'خطا', 'error');
  }

  async function saveEdit(e) {
    e.preventDefault();
    const data = await api(`/api/foods/${edit._id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: edit.name,
        price: Number(edit.price),
        category: edit.category,
        isType1: !!edit.isType1,
      }),
    });
    if (data.success) { toast('ویرایش شد', 'success'); setEdit(null); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  async function remove(id) {
    if (!(await confirmAction({ title: 'حذف غذا؟', confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/foods/${id}`, { method: 'DELETE' });
    if (data.success) { toast('حذف شد', 'success'); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  return (
    <section id="tab-foods" className="tab-pane active">
      <SectionHeader title="غذاها" sub="تعریف دسته‌بندی و غذاهای قابل استفاده در منوی هفته" />

      <div className="card">
        <div className="card-header"><div className="card-title">دسته‌بندی غذا</div></div>
        <div className="card-body">
          <form className="inline-form" onSubmit={addCategory} style={{ marginBottom: 12 }}>
            <input className="form-control" placeholder="نام دسته جدید (مثلاً دسر)" value={catForm.name} onChange={(e) => setCatForm({ name: e.target.value })} required />
            <button className="btn btn-primary" type="submit" disabled={catBusy}><i className="fas fa-folder-plus" /> افزودن دسته</button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((cat) => (
              <span key={cat._id} className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px' }}>
                {cat.name}
                <button type="button" className="btn-icon" style={{ width: 22, height: 22 }} title="حذف دسته" onClick={() => removeCategory(cat)}>
                  <i className="fas fa-times" style={{ fontSize: 10 }} />
                </button>
              </span>
            ))}
            {!categories.length && <span style={{ color: 'var(--text-muted)' }}>هنوز دسته‌ای تعریف نشده</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">افزودن غذای جدید</div></div>
        <div className="card-body">
          <form className="inline-form" onSubmit={addFood}>
            <input className="form-control" placeholder="نام غذا" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="form-control" type="number" placeholder={`قیمت (${tomanLabel()})`} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            <select className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            <label className="form-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!form.isType1} onChange={(e) => setForm({ ...form, isType1: e.target.checked })} />
              نوع یک
            </label>
            <button className="btn btn-primary" type="submit"><i className="fas fa-plus" /> افزودن</button>
          </form>
        </div>
      </div>
      {edit && (
        <div id="foodEditWrap" className="card">
          <div className="card-header">
            <div className="card-title">ویرایش غذا</div>
            <button type="button" className="btn-icon" onClick={() => setEdit(null)}><i className="fas fa-times" /></button>
          </div>
          <div className="card-body">
            <form className="inline-form" onSubmit={saveEdit}>
              <input className="form-control" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
              <input className="form-control" type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} required />
              <select className="form-control" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
              <label className="form-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!!edit.isType1} onChange={(e) => setEdit({ ...edit, isType1: e.target.checked })} />
                نوع یک
              </label>
              <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap">
        {loading ? <AdminSpinner /> : (
          <>
            <table className="table" id="foodsTable">
              <thead><tr><th>نام</th><th>دسته</th><th>نوع یک</th><th>قیمت</th><th>عملیات</th></tr></thead>
              <tbody>
                {foods.map((f) => (
                  <tr key={f._id}>
                    <td style={{ fontWeight: 700 }}>{f.name}</td>
                    <td><span className="badge badge-primary">{catLabel(f.category)}</span></td>
                    <td>{f.isType1 ? <span className="badge badge-success">بله</span> : <span className="badge badge-gray">خیر</span>}</td>
                    <td>{money(f.price)}</td>
                    <TableActions>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit({ ...f })} title="ویرایش"><i className="fas fa-edit" /></button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(f._id)} title="حذف"><i className="fas fa-trash" /></button>
                    </TableActions>
                  </tr>
                ))}
              </tbody>
            </table>
            <div id="foodsPagination"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPage={load} /></div>
          </>
        )}
      </div>
    </section>
  );
}
