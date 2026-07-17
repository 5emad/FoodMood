import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';
import { money } from '../../../utils/format';

const CAT = { lunch: 'ناهار', breakfast: 'صبحانه', dinner: 'شام', snack: 'میان وعده' };

export default function FoodsTab() {
  const { toast } = useToast();
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [form, setForm] = useState({ name: '', price: '', category: 'lunch' });
  const [edit, setEdit] = useState(null);

  async function load(page = 1) {
    setLoading(true);
    const data = await api(`/api/foods?includeInactive=true&page=${page}&limit=20`);
    setFoods(data.success ? data.data : []);
    setPagination(data.pagination || { page, totalPages: 1, total: 0 });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addFood(e) {
    e.preventDefault();
    const data = await api('/api/foods', { method: 'POST', body: JSON.stringify({ ...form, price: Number(form.price) }) });
    if (data.success) { toast('غذا اضافه شد', 'success'); setForm({ name: '', price: '', category: 'lunch' }); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  async function saveEdit(e) {
    e.preventDefault();
    const data = await api(`/api/foods/${edit._id}`, { method: 'PUT', body: JSON.stringify({ name: edit.name, price: Number(edit.price), category: edit.category }) });
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
      <SectionHeader title="غذاها" sub="تعریف غذاهای قابل استفاده در منوی هفته" />
      <div className="card">
        <div className="card-header"><div className="card-title">افزودن غذای جدید</div></div>
        <div className="card-body">
          <form className="inline-form" onSubmit={addFood}>
            <input className="form-control" placeholder="نام غذا" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="form-control" type="number" placeholder="قیمت (تومان)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            <select className="form-control" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
                {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap">
        {loading ? <AdminSpinner /> : (
          <>
            <table className="table" id="foodsTable">
              <thead><tr><th>نام</th><th>دسته</th><th>قیمت</th><th>عملیات</th></tr></thead>
              <tbody>
                {foods.map((f) => (
                  <tr key={f._id}>
                    <td style={{ fontWeight: 700 }}>{f.name}</td>
                    <td><span className="badge badge-primary">{CAT[f.category] || f.category}</span></td>
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
