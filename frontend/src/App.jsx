import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import CompleteProfilePage from './pages/CompleteProfilePage';
import UserDashboardPage from './pages/UserDashboardPage';
import FoodsPage from './pages/FoodsPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import SuperSettingsPage from './pages/admin/SuperSettingsPage';
import SuperSecurityPage from './pages/admin/SuperSecurityPage';
import SuperBackupPage from './pages/admin/SuperBackupPage';
import UnavailablePage from './pages/UnavailablePage';
import NotFoundPage from './pages/NotFoundPage';

function RootRedirect() {
  return <Navigate to="/login" replace />;
}

function LegacyLogout() {
  window.location.href = '/logout';
  return null;
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
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
      <Route path="/admin/super/settings" element={<SuperSettingsPage />} />
      <Route path="/admin/super/security" element={<SuperSecurityPage />} />
      <Route path="/admin/super/backup" element={<SuperBackupPage />} />
      <Route path="/logout" element={<LegacyLogout />} />
      <Route path="/service-unavailable" element={<UnavailablePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
