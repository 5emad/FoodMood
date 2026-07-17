import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import CompleteProfilePage from './pages/CompleteProfilePage';
import UserDashboardPage from './pages/UserDashboardPage';
import FoodsPage from './pages/FoodsPage';
import AdminLayout from './layouts/AdminLayout';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import SuperSettingsPanel from './components/admin/super/SuperSettingsPanel';
import SuperSecurityPanel from './components/admin/super/SuperSecurityPanel';
import SuperBackupPanel from './components/admin/super/SuperBackupPanel';
import UnavailablePage from './pages/UnavailablePage';
import NotFoundPage from './pages/NotFoundPage';
import { adminTabPath, isAdminTab } from './lib/adminPaths';
import { api } from './api/client';

function RootRedirect() {
  return <Navigate to="/login" replace />;
}

function LegacyLogout() {
  (async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    window.location.replace('/login');
  })();
  return null;
}

function AdminLegacyUrlRedirect() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  if (tab && isAdminTab(tab)) {
    return <Navigate to={adminTabPath(tab)} replace />;
  }
  return <Navigate to="/admin/reports" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/complete-profile" element={<CompleteProfilePage />} />
      <Route path="/user" element={<Navigate to="/user/dashboard" replace />} />
      <Route path="/user/dashboard" element={<UserDashboardPage />} />
      <Route path="/foods" element={<FoodsPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/reports" replace />} />
        <Route path="super/settings" element={<SuperSettingsPanel />} />
        <Route path="super/security" element={<SuperSecurityPanel />} />
        <Route path="super/backup" element={<SuperBackupPanel />} />
        <Route path=":tab" element={<AdminDashboardPage />} />
      </Route>
      <Route path="/admin/dashboard" element={<AdminLegacyUrlRedirect />} />
      <Route path="/logout" element={<LegacyLogout />} />
      <Route path="/service-unavailable" element={<UnavailablePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
