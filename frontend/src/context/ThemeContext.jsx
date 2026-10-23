import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'theme-preference'; // 'light' | 'dark' | 'system'
const VALID = ['light', 'dark', 'system'];

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Resolve a preference ('light'|'dark'|'system') to the effective theme. */
function resolveTheme(pref) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

/** Apply the effective theme to <html> (both our attr and Bootstrap's). */
function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-bs-theme', theme);
}

/**
 * Theme provider supporting Light / Dark / System.
 *
 * - The preference is persisted in localStorage (NON-sensitive; never tokens).
 * - 'system' follows prefers-color-scheme and live-updates on OS changes.
 * - The initial attribute is set by an inline script in index.html to avoid a
 *   flash of the wrong theme; this provider keeps React state in sync.
 */
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(() => {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored) ? stored : 'system';
  });

  const [resolved, setResolved] = useState(() => resolveTheme(preference));

  // Re-apply whenever the preference changes.
  useEffect(() => {
    const theme = resolveTheme(preference);
    setResolved(theme);
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [preference]);

  // Follow OS theme changes while in 'system' mode.
  useEffect(() => {
    if (preference !== 'system' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const theme = systemPrefersDark() ? 'dark' : 'light';
      setResolved(theme);
      applyTheme(theme);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);

  const setTheme = useCallback((pref) => {
    if (VALID.includes(pref)) setPreference(pref);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setTheme, isDark: resolved === 'dark' }),
    [preference, resolved, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

export default ThemeContext;
