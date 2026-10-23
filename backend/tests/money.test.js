import { describe, it, expect } from 'vitest';
import { toPaise, toRupees, formatInr, isValidPaise } from '../src/utils/money.js';

describe('money utils — precision-safe INR arithmetic', () => {
  describe('toPaise', () => {
    it('converts whole rupees to paise', () => {
      expect(toPaise(100)).toBe(10000);
    });

    it('converts rupees with paise correctly', () => {
      expect(toPaise(1234.5)).toBe(123450);
      expect(toPaise(0.01)).toBe(1);
    });

    it('absorbs floating-point representation noise', () => {
      // 19.99 * 100 === 1998.9999999999998 in IEEE-754; rounding fixes it.
      expect(toPaise(19.99)).toBe(1999);
      expect(toPaise(0.1 + 0.2)).toBe(30);
    });

    it('accepts numeric strings', () => {
      expect(toPaise('250.75')).toBe(25075);
    });

    it('throws on non-finite input', () => {
      expect(() => toPaise('abc')).toThrow();
      expect(() => toPaise(NaN)).toThrow();
    });
  });

  describe('toRupees', () => {
    it('converts paise back to rupees', () => {
      expect(toRupees(123450)).toBe(1234.5);
      expect(toRupees(1)).toBe(0.01);
    });

    it('throws when given a non-integer', () => {
      expect(() => toRupees(100.5)).toThrow();
    });
  });

  describe('round-trip stability', () => {
    it('preserves value through toPaise -> toRupees', () => {
      for (const rupees of [0, 1, 19.99, 1234.56, 99999.99]) {
        expect(toRupees(toPaise(rupees))).toBeCloseTo(rupees, 2);
      }
    });
  });

  describe('formatInr', () => {
    it('formats paise as an INR currency string', () => {
      const formatted = formatInr(123450);
      expect(formatted).toContain('1,234.50');
      expect(formatted).toMatch(/₹|INR/);
    });
  });

  describe('isValidPaise', () => {
    it('accepts non-negative integers', () => {
      expect(isValidPaise(0)).toBe(true);
      expect(isValidPaise(100)).toBe(true);
    });

    it('rejects negatives and non-integers', () => {
      expect(isValidPaise(-1)).toBe(false);
      expect(isValidPaise(10.5)).toBe(false);
    });

    it('can disallow zero', () => {
      expect(isValidPaise(0, { allowZero: false })).toBe(false);
      expect(isValidPaise(1, { allowZero: false })).toBe(true);
    });
  });
});
