import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/token.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

/**
 * Extract the JWT from the request. The primary mechanism is the HttpOnly auth
 * cookie; a `Authorization: Bearer <token>` header is accepted as a fallback
 * for API clients and backward compatibility. The cookie takes precedence.
 */
function extractToken(req) {
  const cookieToken = req.cookies?.[env.authCookieName];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization || '';
  const [scheme, headerToken] = header.split(' ');
  if (scheme === 'Bearer' && headerToken) return headerToken;

  return null;
}

/**
 * Authentication middleware.
 *
 * - Reads the JWT from the HttpOnly auth cookie (or a Bearer header fallback).
 * - Verifies the JWT signature and expiry (via jsonwebtoken).
 * - Loads the user named in the verified `sub` claim and rejects
 *   missing/inactive accounts.
 * - Attaches `req.userId` and `req.user` for downstream handlers.
 *
 * Identity always comes from the verified token — never from the request body.
 * Error messages are deliberately generic and never echo token contents.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    throw ApiError.unauthorized('Authentication required');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    // Covers invalid signature, malformed token, and expiry.
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account not found or inactive');
  }

  req.userId = user._id.toString();
  req.user = user;
  next();
});

export default requireAuth;
