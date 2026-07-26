import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import CompleteProfilePage from './pages/CompleteProfilePage';
import UserDashboardPage from './pages/UserDashboardPage';
import FoodsPage from './pages/FoodsPage';
import AdminLayout from './layouts/AdminLayout';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import SuperSettingsPanel from './components/admin/super/SuperSettingsPanel';
import SuperSecurityPanel from './components/admin/super/SuperSecurityPanel';
import UnavailablePage from './pages/UnavailablePage';
import NotFoundPage from './pages/NotFoundPage';
import { adminTabPath, isAdminTab } from './lib/adminPaths';

function RootRedirect() {
  // Prefer full navigation so Express redirect + cookies stay in sync
  if (typeof window !== 'undefined') {
    window.location.replace('/login');
  }
  return <Navigate to="/login" replace />;
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
        <Route path="super/backup" element={<Navigate to="/admin/backup" replace />} />
        <Route path=":tab" element={<AdminDashboardPage />} />
      </Route>
      <Route path="/admin/dashboard" element={<AdminLegacyUrlRedirect />} />
      {/* /logout is handled by Express (clears session) — keep a fallback redirect */}
      <Route path="/logout" element={<RootRedirect />} />
      <Route path="/service-unavailable" element={<UnavailablePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
