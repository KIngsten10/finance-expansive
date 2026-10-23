import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * JWT helpers. We use the standard `sub` claim to carry the user id so the
 * server never trusts an id supplied in a request body — identity always comes
 * from a verified token.
 *
 * The signing algorithm is PINNED to HS256 on both sign and verify. Pinning the
 * `algorithms` allowlist on verify prevents algorithm-confusion attacks (an
 * attacker cannot coerce the verifier into accepting a token signed with a
 * different algorithm, e.g. presenting an RS256/"none" token against the HMAC
 * secret). This is defense-in-depth on top of jsonwebtoken v9's own guards.
 */
const JWT_ALGORITHM = 'HS256';

export function signAccessToken(userId) {
  return jwt.sign({}, env.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    subject: userId.toString(),
    expiresIn: env.jwtExpiresIn,
  });
}

/** Verify a token's signature and expiry. Throws on failure (handled upstream). */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { algorithms: [JWT_ALGORITHM] });
}
