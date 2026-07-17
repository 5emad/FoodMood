import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: 'fa-check',
  error: 'fa-xmark',
  warning: 'fa-exclamation',
  info: 'fa-info',
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    const duration = type === 'error' ? 4500 : 3200;
    setItems((prev) => [...prev.slice(-3), { id, message, type }]);
    window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div id="toast-container">
        {items.map((item) => (
          <div key={item.id} className={`app-toast app-toast--${item.type} is-visible`}>
            <button type="button" className="app-toast__close" aria-label="بستن" onClick={() => dismiss(item.id)}>&times;</button>
            <span className="app-toast__text">{item.message}</span>
            <span className="app-toast__icon" aria-hidden="true">
              <i className={`fas ${ICONS[item.type] || ICONS.success}`} />
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
