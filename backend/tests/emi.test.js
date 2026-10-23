import { describe, it, expect } from 'vitest';
import {
  calculateEmiPaise,
  estimateLoanCost,
  buildAmortizationSchedule,
  addMonths,
} from '../src/utils/emi.js';

describe('EMI calculation', () => {
  it('computes EMI for a standard positive-interest loan', () => {
    // ₹5,00,000 @ 9.5% for 60 months. Reducing-balance EMI ≈ ₹10,500.93.
    const emiPaise = calculateEmiPaise(50000000, 9.5, 60);
    expect(emiPaise).toBe(1050093);
  });

  it('handles a zero-interest loan without division by zero', () => {
    // ₹1,20,000 over 12 months -> ₹10,000/month exactly.
    expect(calculateEmiPaise(12000000, 0, 12)).toBe(1000000);
  });

  it('handles a very small interest rate', () => {
    const emiPaise = calculateEmiPaise(10000000, 0.01, 12);
    // Barely above the zero-interest EMI of 833333.
    expect(emiPaise).toBeGreaterThanOrEqual(833333);
    expect(emiPaise).toBeLessThan(835000);
  });

  it('rounds EMI to the nearest paisa (integer paise)', () => {
    const emiPaise = calculateEmiPaise(50000000, 9.5, 60);
    expect(Number.isInteger(emiPaise)).toBe(true);
  });

  it('rejects invalid inputs', () => {
    expect(() => calculateEmiPaise(0, 10, 12)).toThrow();
    expect(() => calculateEmiPaise(100000, -1, 12)).toThrow();
    expect(() => calculateEmiPaise(100000, 10, 0)).toThrow();
  });

  it('estimateLoanCost returns consistent totals', () => {
    const { emiPaise, totalPaymentPaise, totalInterestPaise } = estimateLoanCost(
      12000000,
      0,
      12
    );
    expect(emiPaise).toBe(1000000);
    expect(totalPaymentPaise).toBe(12000000);
    expect(totalInterestPaise).toBe(0);
  });
});

describe('amortization schedule', () => {
  it('closes at exactly zero outstanding (no negative balance)', () => {
    const schedule = buildAmortizationSchedule({
      principalPaise: 50000000,
      annualInterestRate: 9.5,
      tenureMonths: 60,
    });
    expect(schedule).toHaveLength(60);
    const last = schedule[schedule.length - 1];
    expect(last.closingPrincipalPaise).toBe(0);
    // Every closing balance is non-negative.
    expect(schedule.every((s) => s.closingPrincipalPaise >= 0)).toBe(true);
  });

  it('sum of principal portions equals the original principal', () => {
    const principal = 50000000;
    const schedule = buildAmortizationSchedule({
      principalPaise: principal,
      annualInterestRate: 9.5,
      tenureMonths: 60,
    });
    const totalPrincipal = schedule.reduce((s, i) => s + i.principalPaise, 0);
    expect(totalPrincipal).toBe(principal);
  });

  it('zero-interest schedule has no interest and even principal', () => {
    const schedule = buildAmortizationSchedule({
      principalPaise: 12000000,
      annualInterestRate: 0,
      tenureMonths: 12,
    });
    expect(schedule.every((s) => s.interestPaise === 0)).toBe(true);
    expect(schedule[0].principalPaise).toBe(1000000);
  });

  it('respects a lender-provided EMI', () => {
    const schedule = buildAmortizationSchedule({
      principalPaise: 50000000,
      annualInterestRate: 9.5,
      tenureMonths: 60,
      emiPaise: 1060000, // slightly higher lender EMI
    });
    // Higher EMI -> loan clears on or before the scheduled tenure.
    expect(schedule[schedule.length - 1].closingPrincipalPaise).toBe(0);
    expect(schedule.length).toBeLessThanOrEqual(60);
  });

  it('assigns due dates from the first payment date', () => {
    const first = new Date('2026-02-01T00:00:00Z');
    const schedule = buildAmortizationSchedule({
      principalPaise: 12000000,
      annualInterestRate: 0,
      tenureMonths: 3,
      firstPaymentDate: first,
    });
    expect(schedule[0].dueDate.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(schedule[1].dueDate.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(schedule[2].dueDate.toISOString().slice(0, 10)).toBe('2026-04-01');
  });
});

describe('addMonths', () => {
  it('handles month-end overflow (Jan 31 + 1 -> Feb 28)', () => {
    const d = addMonths(new Date('2026-01-31T00:00:00Z'), 1);
    expect(d.getUTCMonth()).toBe(1); // February
    expect(d.getUTCDate()).toBe(28);
  });
});
