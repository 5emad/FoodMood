import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import AdminTabRouter from '../../components/admin/AdminTabRouter';
import { adminTabPath, isAdminTab } from '../../lib/adminPaths';
import AdminSpinner from '../../components/admin/shared/AdminSpinner';

export default function AdminDashboardPage() {
  const { tab: rawTab } = useParams();
  const navigate = useNavigate();
  const ctx = useOutletContext() || {};
  const boot = ctx.boot;
  const tab = isAdminTab(rawTab) ? rawTab : 'reports';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAdminTab(rawTab)) {
      navigate(adminTabPath(tab), { replace: true });
    } else {
      setReady(true);
    }
  }, [rawTab, tab, navigate]);

  useEffect(() => {
    window.__adminNavigate = (nextTab) => {
      if (isAdminTab(nextTab)) navigate(adminTabPath(nextTab));
    };
    return () => { delete window.__adminNavigate; };
  }, [navigate]);

  if (!ready) return <AdminSpinner />;

  return <AdminTabRouter tab={tab} boot={boot} />;
}
