import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

/**
 * Holds authentication state for the app:
 * - `user`: the authenticated user's safe profile (or null)
 * - `initializing`: true while we validate the session on first load
 * - login/register/logout actions
 *
 * Authentication is COOKIE-BASED. The JWT lives in an HttpOnly cookie that the
 * browser sends automatically; it is never accessible to JavaScript. On mount
 * we call /auth/me — if the cookie is valid the request succeeds and hydrates
 * the user; otherwise we stay unauthenticated. There is no localStorage token.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const me = await authApi.fetchMe();
        if (active) setUser(me);
      } catch {
        // No valid session cookie — remain unauthenticated.
        if (active) setUser(null);
      } finally {
        if (active) setInitializing(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  async function login(credentials) {
    const { user: profile } = await authApi.login(credentials);
    setUser(profile);
    return profile;
  }

  async function register(payload) {
    // Register now establishes the session server-side (sets the cookies) and
    // returns the user, so the client lands authenticated without a second call.
    const { user: profile } = await authApi.register(payload);
    setUser(profile);
    return profile;
  }

  async function logout() {
    await authApi.logout();
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      initializing,
      login,
      register,
      logout,
    }),
    [user, initializing]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
