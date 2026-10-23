import { toPaise } from './money.js';
import { ApiError } from './ApiError.js';

/**
 * Parse a rupee amount from request input into integer paise, throwing a 400
 * ApiError (not a raw 500) when the value is missing or non-numeric.
 *
 * @param {*} value         raw input (number or numeric string)
 * @param {string} field    field name for the error message
 * @param {object} [opts]
 * @param {boolean} [opts.required=true]      reject null/undefined
 * @param {boolean} [opts.allowZero=false]    allow exactly 0
 * @param {boolean} [opts.allowNegative=false] allow negatives
 * @returns {number|undefined} integer paise, or undefined when optional + absent
 */
export function parseAmountPaise(value, field, opts = {}) {
  const { required = true, allowZero = false, allowNegative = false } = opts;

  if (value == null || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required`);
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw ApiError.badRequest(`${field} must be a valid number`);
  }
  if (!allowNegative && num < 0) {
    throw ApiError.badRequest(`${field} cannot be negative`);
  }
  if (!allowZero && num === 0) {
    throw ApiError.badRequest(`${field} must be greater than zero`);
  }
  return toPaise(num);
}

/**
 * Parse an integer field (e.g. tenure months, EMI day) with a 400 on bad input.
 */
export function parseInteger(value, field, { required = true, min, max } = {}) {
  if (value == null || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required`);
    return undefined;
  }
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw ApiError.badRequest(`${field} must be an integer`);
  }
  if (min != null && num < min) throw ApiError.badRequest(`${field} must be at least ${min}`);
  if (max != null && num > max) throw ApiError.badRequest(`${field} must be at most ${max}`);
  return num;
}
