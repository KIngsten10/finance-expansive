import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized, validated access to environment variables.
 * Throws early (on import) if a required variable is missing in production.
 */

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key, fallback) => process.env[key] ?? fallback;

const isProd = optional('NODE_ENV', 'development') === 'production';

// Secrets that must never be used in production. Keep in sync with .env.example.
const WEAK_SECRETS = new Set([
  'dev-insecure-secret-change-me',
  'replace-with-a-long-random-secret',
  'secret',
  'changeme',
]);

/**
 * Resolve and validate the JWT secret.
 * - Production: the secret is mandatory, must be reasonably long, and must not
 *   be one of the known placeholder/weak values.
 * - Development/test: fall back to an insecure dev secret so the app boots.
 */
function resolveJwtSecret() {
  if (isProd) {
    const secret = required('JWT_SECRET');
    if (WEAK_SECRETS.has(secret)) {
      throw new Error(
        'JWT_SECRET is set to a known placeholder value. Set a strong, unique secret in production.'
      );
    }
    if (secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production.');
    }
    return secret;
  }
  return optional('JWT_SECRET', 'dev-insecure-secret-change-me');
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd,
  port: parseInt(optional('PORT', '5000'), 10),

  // In production a JWT secret is mandatory and validated for strength; in dev
  // we fall back so the app boots.
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/finance_app'),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),
  bcryptSaltRounds: parseInt(optional('BCRYPT_SALT_ROUNDS', '10'), 10),

  corsOrigins: optional('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // ---- Cookie-based auth ----
  // Cookie names (configurable so they can be namespaced per deployment).
  authCookieName: optional('AUTH_COOKIE_NAME', 'access_token'),
  csrfCookieName: optional('CSRF_COOKIE_NAME', 'csrf_token'),
  // SameSite policy. 'lax' is a good default for a same-site SPA. Use 'none'
  // (which forces Secure) only when the frontend is on a different site and you
  // serve over HTTPS. Validated to one of lax|strict|none.
  cookieSameSite: (() => {
    const v = optional('COOKIE_SAMESITE', 'lax').toLowerCase();
    return ['lax', 'strict', 'none'].includes(v) ? v : 'lax';
  })(),
};

export default env;
