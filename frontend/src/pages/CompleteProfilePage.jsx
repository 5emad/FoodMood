import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ fullName: '', departmentId: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/auth/me').then((res) => {
      if (res.success && res.user && !res.user.mustSetFullName) {
        const target = ['admin', 'superadmin'].includes(res.user.role) ? '/admin/reports' : '/user/dashboard';
        navigate(target);
      }
    });
    api('/api/app/user/bootstrap').then((res) => {
      if (res.success && res.data?.user?.department) {
        setForm((f) => ({ ...f, departmentId: res.data.user.department.id || '' }));
      }
    });
    api('/api/app/user/complete-profile-meta').then((res) => {
      if (res.success) setDepartments(res.data.departments || []);
    });
  }, [navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api('/api/auth/set-fullname', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.success) throw new Error(res.message || 'خطا در ذخیره پروفایل');
      toast('پروفایل با موفقیت تکمیل شد', 'success');
      navigate('/user/dashboard');
    } catch (err) {
      toast(err.message || 'خطا', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-body">
      <div className="auth-wrap" style={{ justifyContent: 'center' }}>
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div className="auth-card-title">تکمیل پروفایل</div>
          <div className="auth-card-sub">نام و واحد سازمانی خود را وارد کنید</div>
          <form onSubmit={onSubmit}>
            <div className="form-group">
              <label className="form-label">نام و نام خانوادگی (فارسی) *</label>
              <input className="form-control" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </div>
            <div className="form-group">
              <label className="form-label">واحد *</label>
              <select className="form-control" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} required>
                <option value="">انتخاب واحد</option>
                {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-w100" disabled={loading}>ذخیره و ادامه</button>
          </form>
        </div>
      </div>
    </div>
  );
}
