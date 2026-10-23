import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { signAccessToken } from '../utils/token.js';
import {
  setAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
} from '../utils/authCookies.js';
import {
  registerUser,
  loginUser,
  getUserProfile,
} from '../services/auth.service.js';

/**
 * Issue a cookie-based session: an HttpOnly JWT cookie plus a readable CSRF
 * cookie. Returns the CSRF token in the body so the SPA can prime its header
 * immediately after login/register.
 */
function establishSession(res, userId) {
  const token = signAccessToken(userId);
  const csrfToken = generateCsrfToken();
  setAuthCookies(res, token, csrfToken);
  return { token, csrfToken };
}

/** POST /api/auth/register — creates the account AND logs the user in. */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  const user = await registerUser({ name, email, password });
  const { token, csrfToken } = establishSession(res, user.id);
  // `token` is included for API clients / backward compatibility; the browser
  // relies on the HttpOnly cookie, not this value.
  sendSuccess(res, { user, token, csrfToken }, { status: 201, message: 'Registration successful' });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  const { token: _unused, user } = await loginUser({ email, password });
  const { token, csrfToken } = establishSession(res, user.id);
  sendSuccess(res, { token, csrfToken, user }, { message: 'Login successful' });
});

/** GET /api/auth/me (protected) */
export const me = asyncHandler(async (req, res) => {
  const user = await getUserProfile(req.userId);
  sendSuccess(res, { user });
});

/**
 * POST /api/auth/logout
 *
 * Clears the HttpOnly auth cookie and the CSRF cookie, ending the browser
 * session. The JWT remains stateless, so a token copied before logout stays
 * valid until it expires — true revocation would need server-side state (a
 * denylist or short-lived access tokens + refresh rotation). Keeping access
 * token lifetimes modest limits that window.
 */
export const logout = asyncHandler(async (req, res) => {
  clearAuthCookies(res);
  sendSuccess(res, null, { message: 'Logged out.' });
});
