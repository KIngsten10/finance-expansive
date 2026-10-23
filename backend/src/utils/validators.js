/**
 * Lightweight, dependency-free input validators used by auth controllers.
 * Each validator returns a normalized value or throws nothing; aggregate
 * errors are collected by the caller into an ApiError with field details.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

/**
 * Password strength policy: at least 8 chars, with at least one lowercase,
 * one uppercase, and one digit. Returns an array of human-readable problems
 * (empty array means valid).
 */
export function passwordProblems(password) {
  const problems = [];
  if (typeof password !== 'string') {
    problems.push('Password is required');
    return problems;
  }
  if (password.length < 8) problems.push('Password must be at least 8 characters');
  if (password.length > 128) problems.push('Password must be at most 128 characters');
  if (!/[a-z]/.test(password)) problems.push('Password must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('Password must contain an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('Password must contain a number');
  return problems;
}
