import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ToastProvider';
import { api } from './api/client';
import { applyAppFont } from './lib/appFont';
import 'sweetalert2/dist/sweetalert2.min.css';
import './styles/spa.css';
import './styles/admin-panel.css';

function Root() {
  useEffect(() => {
    api('/api/app/public').then((res) => {
      if (res.success) applyAppFont(res.data?.uiFont);
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
