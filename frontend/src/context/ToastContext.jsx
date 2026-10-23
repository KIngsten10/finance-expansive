import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

/**
 * Minimal, dependency-free toast system for non-blocking success/error
 * notifications (no browser alert() for ordinary messages). Toasts auto-dismiss.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, { type = 'info', timeout = 4000 } = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((list) => [...list, { id, message, type }]);
      if (timeout) setTimeout(() => dismiss(id), timeout);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (m, o) => push(m, { ...o, type: 'success' }),
      error: (m, o) => push(m, { ...o, type: 'danger' }),
      info: (m, o) => push(m, { ...o, type: 'info' }),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="toast-container position-fixed top-0 end-0 p-3"
        style={{ zIndex: 1080 }}
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast show align-items-center text-bg-${t.type} border-0 mb-2`}
            role="alert"
          >
            <div className="d-flex">
              <div className="toast-body">{t.message}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                aria-label="Close"
                onClick={() => dismiss(t.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export default ToastContext;
