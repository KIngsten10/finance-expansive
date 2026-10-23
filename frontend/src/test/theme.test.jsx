import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

/** Helper to control matchMedia for prefers-color-scheme in jsdom. */
function mockMatchMedia(prefersDark) {
  const listeners = new Set();
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_e, cb) => listeners.add(cb),
    removeEventListener: (_e, cb) => listeners.delete(cb),
    // test hook to simulate an OS theme change
    _emit(matches) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return mql;
}

function ThemeProbe() {
  const { preference, resolved } = useTheme();
  return (
    <div>
      <span data-testid="pref">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-bs-theme');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to system and resolves to the OS preference (dark)', async () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.getByTestId('pref')).toHaveTextContent('system'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('defaults to system and resolves to light when OS prefers light', async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.getByTestId('resolved')).toHaveTextContent('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies an explicit Light selection and persists it', async () => {
    mockMatchMedia(true); // OS is dark, but explicit light must win
    render(
      <ThemeProvider>
        <ThemeSwitcher />
        <ThemeProbe />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /light theme/i }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    );
    expect(screen.getByTestId('pref')).toHaveTextContent('light');
    expect(localStorage.getItem('theme-preference')).toBe('light');
  });

  it('restores a persisted Dark preference on mount', async () => {
    localStorage.setItem('theme-preference', 'dark');
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.getByTestId('resolved')).toHaveTextContent('dark'));
  });

  it('follows OS theme changes while in system mode', async () => {
    const mql = mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.getByTestId('resolved')).toHaveTextContent('light'));
    act(() => mql._emit(true)); // OS switches to dark
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    );
  });

  it('theme switcher marks the active option with aria-pressed', async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>
    );
    const darkBtn = screen.getByRole('button', { name: /dark theme/i });
    fireEvent.click(darkBtn);
    await waitFor(() => expect(darkBtn).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: /light theme/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});
