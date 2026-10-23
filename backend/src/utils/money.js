/**
 * Money utilities. All monetary values are stored and computed as INTEGER PAISE
 * (1 INR = 100 paise) to keep arithmetic precision-safe. Convert to/from rupees
 * only at the application boundary (API input/output, display).
 */

const PAISE_PER_RUPEE = 100;

/**
 * Convert a rupee amount (number or numeric string) to integer paise.
 * Rounds to the nearest paisa to absorb floating-point noise.
 * @param {number|string} rupees
 * @returns {number} integer paise
 */
export function toPaise(rupees) {
  const value = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  return Math.round(value * PAISE_PER_RUPEE);
}

/**
 * Convert integer paise to a rupee number (may have decimals). Primarily for
 * display/serialization; avoid using the result for further arithmetic.
 * @param {number} paise
 * @returns {number} rupees
 */
export function toRupees(paise) {
  if (!Number.isInteger(paise)) {
    throw new Error(`Paise must be an integer, received: ${paise}`);
  }
  return paise / PAISE_PER_RUPEE;
}

/**
 * Format integer paise as a human-readable INR string, e.g. "₹1,234.50".
 * @param {number} paise
 * @returns {string}
 */
export function formatInr(paise) {
  const rupees = toRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Guard that a value is a valid non-negative integer-paise amount.
 * @param {*} paise
 * @param {{ allowZero?: boolean }} opts
 * @returns {boolean}
 */
export function isValidPaise(paise, { allowZero = true } = {}) {
  if (!Number.isInteger(paise)) return false;
  if (paise < 0) return false;
  if (!allowZero && paise === 0) return false;
  return true;
}

/**
 * Serialize integer paise to a rupee JSON NUMBER for API responses.
 *
 * Precision strategy: a JS number safely represents integers up to
 * Number.MAX_SAFE_INTEGER (~9.007e15 paise ≈ ₹90 trillion), which far exceeds
 * any realistic personal-finance value. If a value ever exceeds that bound we
 * refuse to silently lose precision and throw, so the caller can decide on a
 * string-based serialization instead. `null`/`undefined` paise pass through as
 * `null` (used for genuinely unknown values like investment market price).
 *
 * @param {number|null|undefined} paise
 * @returns {number|null}
 */
export function paiseToRupeesNumber(paise) {
  if (paise == null) return null;
  if (!Number.isInteger(paise)) {
    throw new Error(`Paise must be an integer, received: ${paise}`);
  }
  if (Math.abs(paise) > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      'Monetary value exceeds the safe integer range for JSON number serialization'
    );
  }
  return paise / PAISE_PER_RUPEE;
}

export const PAISE = PAISE_PER_RUPEE;
