import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useToast } from '../../ToastProvider';
import { confirmAction, showAlert } from '../../../hooks/useConfirm';
import SectionHeader from '../shared/SectionHeader';
import Pagination from '../shared/Pagination';
import AdminSpinner from '../shared/AdminSpinner';
import TableActions from '../shared/TableActions';

const ROLE = { admin: 'مدیر', superadmin: 'سوپر ادمین', user: 'کاربر' };

export default function UsersTab({ currentUserId, isSuperadmin }) {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', username: '', fullName: '', password: '', email: '', phone: '', role: 'admin', status: 'active', departmentId: '' });

  async function load(page = 1, q = search) {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (String(q || '').trim()) qs.set('search', String(q).trim());
    const [usersData, deptData] = await Promise.all([
      api(`/api/admin/users?${qs}`),
      api('/api/admin/departments'),
    ]);
    setUsers(usersData.success ? usersData.data : []);
    setDepts(deptData.success ? deptData.data : []);
    setPagination(usersData.pagination || { page, totalPages: 1, total: 0 });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (next === search) return;
      setSearch(next);
      load(1, next);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  function openAdd() {
    setForm({ id: '', username: '', fullName: '', password: '', email: '', phone: '', role: 'admin', status: 'active', departmentId: '' });
    setShowForm(true);
  }

  function openEdit(u) {
    const isLdap = u.authSource === 'ldap' || u.ldapUser;
    setForm({
      id: u._id,
      username: u.username || '',
      fullName: u.fullName || '',
      password: '',
      email: u.email || '',
      phone: u.phone || '',
      role: isLdap && u.role === 'superadmin' ? 'admin' : (u.role || 'user'),
      status: u.status || 'active',
      departmentId: u.departmentId?._id || u.departmentId || '',
      isLdap,
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    const editing = users.find((u) => u._id === form.id);
    const isLdap = editing?.authSource === 'ldap' || editing?.ldapUser;
    const body = {
      fullName: form.fullName.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      status: form.id && String(form.id) === String(currentUserId) ? 'active' : form.status,
      departmentId: form.departmentId || null,
      role: form.role,
    };
    if (!isLdap) body.username = form.username.trim();
    if (isLdap && body.role === 'superadmin') body.role = 'admin';
    if (!isLdap && form.password) body.password = form.password;

    const data = form.id
      ? await api(`/api/admin/users/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });

    if (data.success) {
      setShowForm(false);
      load(pagination.page);
      if (data.superToken && isSuperadmin) {
        await showAlert({ title: 'توکن سوپرادمین', text: data.superToken, icon: 'success' });
      } else toast(data.message || 'ذخیره شد', 'success');
    } else toast(data.message || 'خطا', 'error');
  }

  async function remove(id, name) {
    if (!(await confirmAction({ title: 'حذف کاربر؟', text: `«${name}» حذف می‌شود.`, confirmText: 'حذف', icon: 'warning' }))) return;
    const data = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (data.success) { toast('حذف شد', 'success'); load(pagination.page); }
    else toast(data.message || 'خطا', 'error');
  }

  const editingUser = users.find((u) => u._id === form.id);
  const isLdapForm = form.isLdap || editingUser?.authSource === 'ldap' || editingUser?.ldapUser;

  return (
    <section id="tab-users" className="tab-pane active">
      <SectionHeader
        title="مدیریت کاربران"
        sub="افزودن، ویرایش و غیرفعال‌سازی کاربران سامانه"
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={openAdd}><i className="fas fa-user-plus" /> کاربر جدید</button>}
      />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body" style={{ padding: '12px 16px' }}>
          <div className="inline-form" style={{ margin: 0 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <i className="fas fa-search" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="form-control"
                style={{ paddingRight: 36 }}
                placeholder="جستجو بر اساس نام، نام کاربری، ایمیل یا موبایل…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            {searchInput ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setSearchInput(''); setSearch(''); load(1, ''); }}>
                پاک کردن
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {showForm && (
        <div id="userFormWrap" className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div className="card-title" id="userFormTitle">{form.id ? 'ویرایش کاربر' : 'افزودن کاربر'}</div>
            <button type="button" className="btn-icon" onClick={() => setShowForm(false)}><i className="fas fa-times" /></button>
          </div>
          <div className="card-body">
            <form id="userForm" onSubmit={save} autoComplete="off">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">نام کاربری *</label>
                  {!isLdapForm
                    ? <input className="form-control" id="uf_username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required={!form.id} placeholder="مثال: 09121234567" />
                    : <input className="form-control" id="uf_username" value={form.username} readOnly />}
                </div>
                <div className="form-group">
                  <label className="form-label">نام کامل (فارسی) *</label>
                  <input className="form-control" id="uf_fullName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required placeholder="علی احمدی" />
                </div>
                {!isLdapForm && (
                  <div className="form-group">
                    <label className="form-label">رمز عبور</label>
                    <input className="form-control" id="uf_password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="در ویرایش خالی = بدون تغییر" autoComplete="new-password" />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">ایمیل</label>
                  <input className="form-control" id="uf_email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">موبایل</label>
                  <input className="form-control" id="uf_phone" dir="ltr" placeholder="09121234567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">واحد</label>
                  <select className="form-control" id="uf_dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">بدون واحد</option>
                    {depts.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">نقش</label>
                  <select className="form-control" id="uf_role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={form.id && String(form.id) === String(currentUserId)}>
                    <option value="user">کاربر عادی</option>
                    <option value="admin">مدیر</option>
                    {!isLdapForm && isSuperadmin && <option value="superadmin">سوپر ادمین</option>}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">وضعیت</label>
                  <select className="form-control" id="uf_status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={form.id && String(form.id) === String(currentUserId)}>
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" type="submit"><i className="fas fa-save" /> ذخیره</button>
                <button className="btn btn-outline" type="button" onClick={() => setShowForm(false)}>انصراف</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap" id="usersTableWrap">
        {loading ? <AdminSpinner /> : (
          <>
            <table className="table">
              <thead><tr><th>نام کامل</th><th>نام کاربری</th><th>واحد</th><th>نقش</th><th>وضعیت</th><th>عملیات</th></tr></thead>
              <tbody>
                {users.length ? users.map((u) => (
                  <tr key={u._id}>
                    <td style={{ fontWeight: 700 }}>{u.fullName || '-'}</td>
                    <td style={{ direction: 'ltr', textAlign: 'center' }}>{u.username}</td>
                    <td>{u.departmentId?.name || '-'}</td>
                    <td>{ROLE[u.role] || u.role}{(u.authSource === 'ldap' || u.ldapUser) && ' (AD)'}</td>
                    <td><span className={`badge badge-${u.status === 'active' ? 'success' : 'danger'}`}>{u.status === 'active' ? 'فعال' : 'غیرفعال'}</span></td>
                    <TableActions>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(u)} title="ویرایش"><i className="fas fa-edit" /></button>
                      {String(u._id) === String(currentUserId)
                        ? <span className="badge badge-gray" title="حساب خودتان قابل حذف نیست">شما</span>
                        : <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(u._id, u.fullName || u.username)} title="حذف"><i className="fas fa-trash" /></button>}
                    </TableActions>
                  </tr>
                )) : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{search ? 'نتیجه‌ای یافت نشد' : 'کاربری ثبت نشده'}</td></tr>}
              </tbody>
            </table>
            <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPage={(p) => load(p)} />
          </>
        )}
      </div>
    </section>
  );
}
