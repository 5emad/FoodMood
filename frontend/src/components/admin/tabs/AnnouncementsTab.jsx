import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';
import { useJalaliDatepicker } from '../../../hooks/useJalaliDatepicker';
import { jdate } from '../../../utils/format';

export default function AnnouncementsTab() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', title: '', body: '', audience: 'all', isActive: true, jalaliExpiresAt: '', departmentIds: [] });

  useJalaliDatepicker(showForm);
  async function load() {
    setLoading(true);
    const [ann, dept] = await Promise.all([api('/api/admin/announcements'), api('/api/admin/departments')]);
    setItems(ann.success ? ann.data : []);
    setDepts(dept.success ? dept.data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setForm({ id: '', title: '', body: '', audience: 'all', isActive: true, jalaliExpiresAt: '', departmentIds: [] });
    setShowForm(true);
  }

  function openEdit(item) {
    setForm({
      id: item._id,
      title: item.title || '',
      body: item.body || '',
      audience: item.audience || 'all',
      isActive: item.isActive !== false,
      jalaliExpiresAt: item.jalaliExpiresAt || '',
      departmentIds: (item.departmentIds || []).map(String),
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      audience: form.audience,
      isActive: form.isActive,
      jalaliExpiresAt: form.jalaliExpiresAt || null,
      departmentIds: form.audience === 'department' ? form.departmentIds : [],
    };
    const data = form.id
      ? await api(`/api/admin/announcements/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify(payload) });
    if (data.success) { toast('ذخیره شد', 'success'); setShowForm(false); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  async function remove(id) {
    if (!(await confirmAction({ title: 'حذف اطلاعیه؟', confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/admin/announcements/${id}`, { method: 'DELETE' });
    if (data.success) { toast('حذف شد', 'success'); load(); }
    else toast(data.message || 'خطا', 'error');
  }

  function onDeptSelect(e) {
    const selected = [...e.target.selectedOptions].map((o) => o.value);
    setForm((f) => ({ ...f, departmentIds: selected }));
  }

  return (
    <section id="tab-announcements" className="tab-pane active">
      <SectionHeader
        title="مدیریت اطلاعیه‌ها"
        sub="ارسال پیام به همه کاربران یا واحدهای مشخص"
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={openAdd}><i className="fas fa-plus" /> اطلاعیه جدید</button>}
      />
      {showForm && (
        <div id="announcementFormWrap" className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div className="card-title" id="announcementFormTitle">{form.id ? 'ویرایش اطلاعیه' : 'ثبت اطلاعیه'}</div>
            <button type="button" className="btn-icon" onClick={() => setShowForm(false)}><i className="fas fa-times" /></button>
          </div>
          <div className="card-body">
            <form id="announcementForm" onSubmit={save}>
              <div className="form-group">
                <label className="form-label">عنوان *</label>
                <input className="form-control" id="ann_title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} placeholder="مثال: تعطیلی سلف سرویس" />
              </div>
              <div className="form-group">
                <label className="form-label">متن اطلاعیه *</label>
                <textarea className="form-control" id="ann_body" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required maxLength={2000} placeholder="متن پیام برای کاربران" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">مخاطب</label>
                  <select className="form-control" id="ann_audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                    <option value="all">همه کاربران سامانه</option>
                    <option value="department">واحد مشخص</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">وضعیت</label>
                  <select className="form-control" id="ann_active" value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                    <option value="1">فعال (نمایش به کاربران)</option>
                    <option value="0">غیرفعال</option>
                  </select>
                </div>
              </div>
              {form.audience === 'department' && (
                <div className="form-group" id="ann_depts_wrap">
                  <label className="form-label">واحدهای هدف *</label>
                  <select className="form-control" id="ann_departments" multiple size={5} value={form.departmentIds} onChange={onDeptSelect}>
                    {depts.map((d) => <option key={d._id} value={String(d._id)}>{d.name}</option>)}
                  </select>
                  <div className="text-muted" style={{ fontSize: '.75rem', marginTop: 6 }}>برای انتخاب چند واحد، Ctrl را نگه دارید</div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">تاریخ انقضا (شمسی — اختیاری)</label>
                <input
                  className="form-control"
                  id="ann_expires"
                  data-jdp
                  data-jdp-only-date
                  autoComplete="off"
                  value={form.jalaliExpiresAt}
                  onChange={(e) => setForm({ ...form, jalaliExpiresAt: e.target.value })}
                  placeholder="مثال: ۱۴۰۴/۰۴/۲۰"
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
                <button className="btn btn-outline" type="button" onClick={() => setShowForm(false)}>انصراف</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap" id="announcementsTableWrap">
        {loading ? <AdminSpinner /> : (
          <table className="table">
            <thead><tr><th>عنوان</th><th>مخاطب</th><th>وضعیت</th><th>انقضا</th><th>تاریخ</th><th>عملیات</th></tr></thead>
            <tbody>
              {items.length ? items.map((a) => (
                <tr key={a._id}>
                  <td style={{ fontWeight: 700 }}>{a.title}</td>
                  <td><span className="badge badge-primary">{a.audience === 'department' ? 'واحد' : 'همه'}</span></td>
                  <td><span className={`badge badge-${a.isActive ? 'success' : 'gray'}`}>{a.isActive ? 'فعال' : 'غیرفعال'}</span></td>
                  <td>{a.jalaliExpiresAt || '—'}</td>
                  <td>{a.createdAt ? jdate(a.createdAt) : '—'}</td>
                  <TableActions>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(a)} title="ویرایش"><i className="fas fa-edit" /></button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(a._id)} title="حذف"><i className="fas fa-trash" /></button>
                  </TableActions>
                </tr>
              )) : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>اطلاعیه‌ای ثبت نشده</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
