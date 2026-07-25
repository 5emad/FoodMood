import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ToastProvider';
import { api } from './api/client';
import { applyAppFont, refreshThemeVars } from './lib/appFont';
import 'sweetalert2/dist/sweetalert2.min.css';
import 'sonner/dist/styles.css';
import './styles/spa.css';
import './styles/admin-panel.css';

function getBootstrapData() {
  try {
    const el = document.getElementById('app-bootstrap-data');
    if (!el) return null;
    return JSON.parse(el.textContent || '{}');
  } catch {
    return null;
  }
}

const boot = getBootstrapData();
if (boot && boot.settings && boot.settings.uiFont) {
  applyAppFont(boot.settings.uiFont);
}

function Root() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.dataset.reactMounted = '1';

    api('/api/app/public').then((res) => {
      if (res.success) {
        if (!boot) applyAppFont(res.data?.uiFont);
        refreshThemeVars();
      }
    }).catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

// Visible fallback if the bundle never mounts (blank white page)
window.setTimeout(() => {
  const root = document.getElementById('root');
  if (root && !root.dataset.reactMounted && root.childElementCount === 0) {
    root.innerHTML = '<div style="font-family:Tahoma,sans-serif;padding:2rem;text-align:center;direction:rtl">'
      + '<p>بارگذاری صفحه ورود ناموفق بود.</p>'
      + '<p style="color:#666;font-size:.9rem">لطفاً صفحه را سخت‌رفرش کنید (Ctrl+F5) یا کش مرورگر را پاک کنید.</p>'
      + '<a href="/login">تلاش مجدد</a></div>';
  }
}, 4000);
