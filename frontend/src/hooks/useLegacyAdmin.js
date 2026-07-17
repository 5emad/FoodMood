import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, loadScript } from '../api/client';

function injectBootstrap(boot) {
  let el = document.getElementById('admin-bootstrap');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'admin-bootstrap';
    document.body.appendChild(el);
  }
  el.textContent = JSON.stringify(boot);
}

export function useLegacyAdminDashboard(activeTab) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [bootRes, markupRes] = await Promise.all([
          api('/api/app/admin/bootstrap'),
          fetch('/api/app/admin/dashboard-markup', { credentials: 'same-origin' }),
        ]);

        if (!bootRes.success) throw new Error(bootRes.message || 'bootstrap failed');
        const markup = await markupRes.text();

        const mount = document.getElementById('admin-legacy-mount');
        if (!mount) return;
        mount.innerHTML = markup;

        const boot = {
          ...bootRes.data,
          activePage: activeTab || 'reports',
        };
        injectBootstrap(boot);

        await loadScript('/vendor/sweetalert2/sweetalert2.min.js');
        await loadScript('/vendor/jalalidatepicker/jalalidatepicker.min.js');
        await loadScript('/js/app-toast.js');
        await loadScript('/js/portal-capabilities.js');
        await loadScript('/js/admin-core.js');
        await loadScript('/js/admin-dashboard.js');

        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e.message || 'خطا در بارگذاری پنل ادمین');
      }
    }

    setReady(false);
    setError('');
    init();

    return () => { cancelled = true; };
  }, [activeTab]);

  return { ready, error };
}

export function useLegacySuperPage(scriptName, markupUrl) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await api('/api/app/admin/bootstrap');
        const markupRes = await fetch(markupUrl, { credentials: 'same-origin' });
        const markup = await markupRes.text();
        const mount = document.getElementById('super-legacy-mount');
        if (mount) mount.innerHTML = markup;

        await loadScript('/vendor/sweetalert2/sweetalert2.min.js');
        await loadScript('/js/app-toast.js');
        await loadScript('/js/admin-core.js');
        await loadScript(`/js/${scriptName}.js`);

        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e.message || 'خطا در بارگذاری صفحه');
      }
    }

    init();
    return () => { cancelled = true; };
  }, [scriptName, markupUrl]);

  return { ready, error };
}
