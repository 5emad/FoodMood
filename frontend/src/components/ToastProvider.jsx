import { createContext, useCallback, useContext, useMemo } from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';

const ToastContext = createContext(null);

function showToast(message, type = 'success') {
  const opts = {
    duration: type === 'error' ? 5000 : 3500,
  };

  switch (type) {
    case 'error':
      return sonnerToast.error(message, opts);
    case 'warning':
      return sonnerToast.warning(message, opts);
    case 'info':
      return sonnerToast.info(message, opts);
    default:
      return sonnerToast.success(message, opts);
  }
}

export function ToastProvider({ children }) {
  const toast = useCallback((message, type = 'success') => showToast(message, type), []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        dir="rtl"
        position="bottom-left"
        richColors
        closeButton
        expand
        visibleToasts={4}
        toastOptions={{
          classNames: {
            toast: 'sonner-toast-root',
            title: 'sonner-toast-title',
            description: 'sonner-toast-desc',
            closeButton: 'sonner-toast-close',
          },
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
