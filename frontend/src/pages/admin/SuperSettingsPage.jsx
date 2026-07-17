import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import { loadScript } from '../../api/client';

export default function SuperSettingsPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.body.className = 'admin-body';
    (async () => {
      const res = await fetch('/api/app/admin/super/settings-markup', { credentials: 'same-origin' });
      const html = await res.text();
      const mount = document.getElementById('super-legacy-mount');
      if (mount) mount.innerHTML = html;
      await loadScript('/vendor/sweetalert2/sweetalert2.min.js');
      await loadScript('/js/app-toast.js');
      await loadScript('/js/admin-core.js');
      await loadScript('/js/admin-super-settings.js');
      setReady(true);
    })();
  }, []);

  return (
    <AdminLayout activePage="super-settings" pageTitle="تنظیمات سامانه" pageSub="نام سازمان، ظاهر، LDAP و محدودیت‌های رزرو">
      {!ready && <div className="spinner" style={{ margin: '40px auto' }} />}
      <div id="super-legacy-mount" />
    </AdminLayout>
  );
}
