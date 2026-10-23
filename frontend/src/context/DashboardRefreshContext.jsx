import { createContext, useContext, useCallback, useMemo, useState } from 'react';

const DashboardRefreshContext = createContext(null);

/**
 * Lightweight cross-page signal: pages that perform financial mutations call
 * `requestRefresh()`, and the Dashboard re-fetches when its `version` changes.
 * This avoids prop-drilling and prevents unnecessary polling.
 */
export function DashboardRefreshProvider({ children }) {
  const [version, setVersion] = useState(0);
  const requestRefresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ version, requestRefresh }), [version, requestRefresh]);
  return (
    <DashboardRefreshContext.Provider value={value}>
      {children}
    </DashboardRefreshContext.Provider>
  );
}

export function useDashboardRefresh() {
  const ctx = useContext(DashboardRefreshContext);
  if (!ctx) throw new Error('useDashboardRefresh must be used within its provider');
  return ctx;
}

export default DashboardRefreshContext;
