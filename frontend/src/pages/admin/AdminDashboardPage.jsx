import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminLayout from '../../layouts/AdminLayout';
import { useLegacyAdminDashboard } from '../../hooks/useLegacyAdmin';

export default function AdminDashboardPage() {
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'reports';
  const { ready, error } = useLegacyAdminDashboard(tab);

  return (
    <AdminLayout activeTab={tab} pageTitle="مدیریت هوشمند تغذیه" pageSub="">
      {error && <div className="alert alert-danger">{error}</div>}
      {!ready && !error && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}
      <div id="admin-legacy-mount" />
    </AdminLayout>
  );
}
