import crypto from 'crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyCsrfToken } from '../utils/authCookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Session-ESTABLISHING auth endpoints are CSRF-exempt. They are the entry
 * points that mint the CSRF token in the first place, so requiring a
 * pre-existing one is impossible for a first-time user and breaks login/
 * registration whenever a stale `access_token` cookie is still present. These
 * endpoints are safe to exempt because they are gated by credentials in the
 * request body and issue fresh cookies (overwriting any stale session); a
 * cross-site forgery cannot authenticate as the victim without their password.
 * Logout is intentionally NOT exempt — during an active session the client
 * holds a valid CSRF token.
 *
 * Paths are relative to the `/api` mount point where this middleware runs.
 */
const CSRF_EXEMPT_PATHS = new Set(['/auth/login', '/auth/register']);

/** Constant-time string comparison to avoid timing side channels. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * CSRF protection using a SIGNED double-submit-cookie pattern.
 *
 * Applies only to state-changing methods (POST/PUT/PATCH/DELETE). A request is
 * accepted when:
 *   1. the `X-CSRF-Token` header equals the `csrf_token` cookie, AND
 *   2. that token carries a valid server HMAC signature.
 *
 * The signature check (2) defends against cookie injection: an attacker on a
 * sibling/subdomain (or a MITM on a non-HTTPS path) can set a `csrf_token`
 * cookie on the parent domain and match it in the header, but cannot produce a
 * value the server signed, so the forged token is rejected. This is the
 * "signed double-submit" hardening over a plain value comparison.
 *
 * Requests that authenticate via the Authorization: Bearer header with NO auth
 * cookie are EXEMPT: cross-site attackers cannot set a custom Authorization
 * header, so those requests are not CSRF-vulnerable. This keeps programmatic
 * API clients working while protecting browser cookie sessions.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Session-establishing auth endpoints are exempt (see note above). Match on
  // the path without query string, trimming any trailing slash.
  const path = req.path.replace(/\/+$/, '') || '/';
  if (CSRF_EXEMPT_PATHS.has(path)) return next();

  const hasAuthCookie = Boolean(req.cookies?.[env.authCookieName]);
  const usesBearer = (req.headers.authorization || '').startsWith('Bearer ');

  // No cookie session to protect (pure bearer or unauthenticated request).
  if (!hasAuthCookie && usesBearer) return next();
  if (!hasAuthCookie) return next(); // unauthenticated; requireAuth will reject later

  const cookieToken = req.cookies[env.csrfCookieName];
  const headerToken = req.get('X-CSRF-Token');

  if (
    !cookieToken ||
    !headerToken ||
    !safeEqual(cookieToken, headerToken) ||
    !verifyCsrfToken(headerToken)
  ) {
    return next(ApiError.forbidden('Invalid or missing CSRF token'));
  }
  return next();
}

export default csrfProtection;
