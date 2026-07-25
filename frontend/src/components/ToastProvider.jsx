import { createContext, useCallback, useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Toaster, toast as sonnerToast } from 'sonner';
import 'sonner/dist/styles.css';

const ToastContext = createContext(null);

function showToast(message, type = 'success') {
  const text = String(message || '').trim() || 'پیام سامانه';
  const opts = {
    duration: type === 'error' ? 5600 : 4000,
    id: `${type}:${text}`,
  };

  switch (type) {
    case 'error':
      return sonnerToast.error(text, opts);
    case 'warning':
      return sonnerToast.warning(text, opts);
    case 'info':
      return sonnerToast.info(text, opts);
    default:
      return sonnerToast.success(text, opts);
  }
}

export function ToastProvider({ children }) {
  const toast = useCallback((message, type = 'success') => showToast(message, type), []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined'
        && createPortal(
          <Toaster
            dir="rtl"
            theme="light"
            position="top-center"
            richColors
            closeButton
            expand
            gap={12}
            offset={24}
            visibleToasts={4}
            toastOptions={{
              classNames: {
                toast: 'app-sonner-toast',
                title: 'app-sonner-title',
                closeButton: 'app-sonner-close',
              },
            }}
          />,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
