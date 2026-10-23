import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signAccessToken } from '../utils/token.js';
import {
  isNonEmptyString,
  isValidEmail,
  normalizeEmail,
  passwordProblems,
} from '../utils/validators.js';

/**
 * Register a new user. Validates input, enforces password strength, hashes the
 * password, and guards against duplicate emails. Only whitelisted fields are
 * persisted (prevents mass assignment of isActive, passwordHash, etc.).
 */
export async function registerUser({ name, email, password }) {
  const errors = [];
  if (!isNonEmptyString(name)) errors.push({ field: 'name', message: 'Name is required' });
  if (!isValidEmail(email)) errors.push({ field: 'email', message: 'A valid email is required' });
  passwordProblems(password).forEach((message) =>
    errors.push({ field: 'password', message })
  );

  if (errors.length > 0) {
    throw ApiError.badRequest('Validation failed', errors);
  }

  const normalizedEmail = normalizeEmail(email);

  // Pre-check for a friendlier 409 than relying solely on the unique index.
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    });
    return user.toSafeJSON();
  } catch (err) {
    // Race condition: unique index caught a concurrent duplicate insert.
    if (err.code === 11000) {
      throw ApiError.conflict('An account with this email already exists');
    }
    throw err;
  }
}

/**
 * Authenticate a user. Uses a single generic error for both unknown email and
 * wrong password so the endpoint does not reveal whether an email exists.
 * Inactive accounts are rejected.
 */
export async function loginUser({ email, password }) {
  const genericError = ApiError.unauthorized('Invalid email or password');

  if (!isValidEmail(email) || !isNonEmptyString(password)) {
    throw genericError;
  }

  const normalizedEmail = normalizeEmail(email);
  // passwordHash is select:false, so request it explicitly.
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    // Run a dummy compare to reduce timing differences between
    // "no such user" and "wrong password".
    await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv');
    throw genericError;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw genericError;
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account is inactive');
  }

  const token = signAccessToken(user._id);
  return { token, user: user.toSafeJSON() };
}

/** Load the authenticated user's safe profile by id. */
export async function getUserProfile(userId) {
  const user = await User.findById(userId);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account not found or inactive');
  }
  return user.toSafeJSON();
}
