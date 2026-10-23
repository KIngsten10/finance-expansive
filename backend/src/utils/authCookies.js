import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Cookie-based session helpers.
 *
 * Two cookies are used:
 *  - access_token (HttpOnly): the JWT. Never readable by JavaScript, so it is
 *    not exposed to XSS the way localStorage is.
 *  - csrf_token (NOT HttpOnly): a random value the SPA reads and echoes back in
 *    an `X-CSRF-Token` header. The server compares the header to the cookie
 *    (double-submit pattern) on state-changing requests.
 *
 * `SameSite` + `Secure` are configured from env. In production Secure is forced
 * on (and when SameSite=None, Secure is mandatory per the cookie spec).
 */

// Convert the JWT lifetime (e.g. '7d') to milliseconds for cookie maxAge.
// Mirrors the token's own expiry so the cookie and JWT expire together.
function jwtMaxAgeMs() {
  const v = env.jwtExpiresIn;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(v).trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * mult;
}

function baseCookieOptions() {
  const secure = env.isProd || env.cookieSameSite === 'none';
  return {
    sameSite: env.cookieSameSite,
    secure,
    path: '/',
  };
}

/**
 * Generate a SIGNED CSRF token: `<random>.<hmac>` where hmac = HMAC-SHA256 of
 * the random part keyed by the server's JWT secret. Signing binds the token to
 * the server: an attacker who injects a `csrf_token` cookie value (e.g. from a
 * sibling subdomain) cannot produce a valid signature, so the double-submit
 * check rejects forged/injected tokens — closing the classic double-submit
 * cookie-injection weakness.
 */
export function generateCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('hex');
  const sig = crypto.createHmac('sha256', env.jwtSecret).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

/** Verify a CSRF token's signature (constant-time). Returns boolean. */
export function verifyCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const nonce = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', env.jwtSecret).update(nonce).digest('hex');
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Set both the HttpOnly auth cookie and the readable CSRF cookie. */
export function setAuthCookies(res, token, csrfToken) {
  const maxAge = jwtMaxAgeMs();
  const base = baseCookieOptions();

  res.cookie(env.authCookieName, token, {
    ...base,
    httpOnly: true, // never exposed to JS
    maxAge,
  });
  res.cookie(env.csrfCookieName, csrfToken, {
    ...base,
    httpOnly: false, // the SPA must read this to echo it in a header
    maxAge,
  });
}

/** Clear both auth cookies (logout / invalid session). */
export function clearAuthCookies(res) {
  const base = baseCookieOptions();
  res.clearCookie(env.authCookieName, { ...base, httpOnly: true });
  res.clearCookie(env.csrfCookieName, { ...base, httpOnly: false });
}
