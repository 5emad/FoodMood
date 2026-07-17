import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';
import { faDigits } from '../../../utils/format';

export default function DepartmentsTab() {
  const { toast } = useToast();
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ id: '', name: '' });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const data = await api('/api/admin/departments');
    setDepts(data.success ? data.data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() { setForm({ id: '', name: '' }); setShowForm(true); }
  function openEdit(d) { setForm({ id: d._id, name: d.name }); setShowForm(true); }

  async function save(e) {
    e.preventDefault();
    const body = { name: form.name.trim() };
    const data = form.id
      ? await api(`/api/admin/departments/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/admin/departments', { method: 'POST', body: JSON.stringify(body) });
    if (data.success) { toast('ذخیره شد', 'success'); setShowForm(false); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  async function remove(id, name) {
    if (!(await confirmAction({ title: 'حذف واحد؟', text: `واحد «${name}» حذف می‌شود.`, confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/admin/departments/${id}`, { method: 'DELETE' });
    if (data.success) { toast('حذف شد', 'success'); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  return (
    <section id="tab-departments" className="tab-pane active">
      <SectionHeader
        title="مدیریت واحدهای سازمانی"
        sub="افزودن، ویرایش و حذف واحدهای سازمان"
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={openAdd}><i className="fas fa-plus" /> واحد جدید</button>}
      />
      {showForm && (
        <div id="deptFormWrap" className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div className="card-title" id="deptFormTitle">{form.id ? 'ویرایش واحد' : 'افزودن واحد'}</div>
            <button type="button" className="btn-icon" onClick={() => setShowForm(false)}><i className="fas fa-times" /></button>
          </div>
          <div className="card-body">
            <form id="deptForm" onSubmit={save}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label">نام واحد *</label>
                  <input className="form-control" id="df_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="مثال: واحد مالی" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
                  <button className="btn btn-outline" type="button" onClick={() => setShowForm(false)}>انصراف</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap" id="deptsTableWrap">
        {loading ? <AdminSpinner /> : (
          <table className="table">
            <thead><tr><th>نام واحد</th><th>کاربران</th><th>عملیات</th></tr></thead>
            <tbody>
              {depts.length ? depts.map((d) => (
                <tr key={d._id}>
                  <td style={{ fontWeight: 700 }}>{d.name}</td>
                  <td>{faDigits(d.userCount || 0)} نفر</td>
                  <TableActions>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(d)} title="ویرایش"><i className="fas fa-edit" /></button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(d._id, d.name)} title="حذف"><i className="fas fa-trash" /></button>
                  </TableActions>
                </tr>
              )) : <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>واحدی ثبت نشده</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
