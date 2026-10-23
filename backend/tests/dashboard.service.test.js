import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Loan } from '../src/models/Loan.js';
import { Investment } from '../src/models/Investment.js';
import {
  recordExpense,
  recordTransfer,
  reverseTransaction,
} from '../src/services/transaction.service.js';
import { recordInvestmentPurchase } from '../src/services/investment.service.js';
import {
  getTotalBankBalancePaise,
  getExpensesTodayPaise,
  getExpensesThisMonthPaise,
  getOutstandingLoanPrincipalPaise,
  getInvestmentCostBasisPaise,
  getInvestmentCurrentValuation,
} from '../src/services/dashboard.service.js';
import { istDayRange, istMonthRange } from '../src/utils/datetime.js';

describe('dashboard aggregations (replica set)', () => {
  let replset;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replset = await startReplSet();
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  async function makeAccount(balance) {
    return BankAccount.create({
      userId,
      bankName: 'Bank',
      accountName: 'Main',
      openingBalancePaise: balance,
      currentBalancePaise: balance,
    });
  }

  it('sums total bank balance across active accounts only', async () => {
    await makeAccount(100000);
    await makeAccount(50000);
    await BankAccount.create({
      userId,
      bankName: 'Old',
      accountName: 'Closed',
      openingBalancePaise: 999999,
      currentBalancePaise: 999999,
      isActive: false,
    });
    expect(await getTotalBankBalancePaise(userId)).toBe(150000);
  });

  it('counts posted expenses for today and excludes reversed ones', async () => {
    const acct = await makeAccount(1000000);
    const now = new Date();
    await recordExpense({ userId, accountId: acct._id, amountPaise: 10000, transactionDate: now });
    const { transaction } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 5000,
      transactionDate: now,
    });
    // Reverse the second expense — it must drop out of totals.
    await reverseTransaction({ userId, transactionId: transaction._id });

    expect(await getExpensesTodayPaise(userId, now)).toBe(10000);
    expect(await getExpensesThisMonthPaise(userId, now)).toBe(10000);
  });

  it('excludes transfers from expense totals', async () => {
    const a = await makeAccount(1000000);
    const b = await makeAccount(0);
    await recordTransfer({
      userId,
      sourceAccountId: a._id,
      destinationAccountId: b._id,
      amountPaise: 50000,
      transactionDate: new Date(),
    });
    expect(await getExpensesTodayPaise(userId, new Date())).toBe(0);
  });

  it('sums outstanding loan principal for active loans', async () => {
    await Loan.create({
      userId,
      lenderName: 'A',
      loanName: 'L1',
      originalPrincipalPaise: 200000,
      outstandingPrincipalPaise: 150000,
      annualInterestRate: 8,
      startDate: new Date(),
      tenureMonths: 24,
      status: 'active',
    });
    await Loan.create({
      userId,
      lenderName: 'B',
      loanName: 'L2',
      originalPrincipalPaise: 100000,
      outstandingPrincipalPaise: 0,
      annualInterestRate: 8,
      startDate: new Date(),
      tenureMonths: 24,
      status: 'closed',
    });
    expect(await getOutstandingLoanPrincipalPaise(userId)).toBe(150000);
  });

  it('reports investment cost basis separately from current valuation', async () => {
    const acct = await makeAccount(1000000);
    const inv = await Investment.create({
      userId,
      name: 'ACME',
      investmentType: 'stock',
      totalInvestedPaise: 0,
    });
    await recordInvestmentPurchase({
      userId,
      investmentId: inv._id,
      accountId: acct._id,
      amountPaise: 300000,
      quantity: 10,
    });
    // A second holding with a KNOWN current value.
    await Investment.create({
      userId,
      name: 'Gold',
      investmentType: 'gold',
      totalInvestedPaise: 100000,
      currentValuePaise: 120000,
    });

    expect(await getInvestmentCostBasisPaise(userId)).toBe(400000);
    const valuation = await getInvestmentCurrentValuation(userId);
    // Only the Gold holding has a known value.
    expect(valuation.knownValuationPaise).toBe(120000);
    expect(valuation.holdingsWithKnownValue).toBe(1);
    expect(valuation.holdingsWithUnknownValue).toBe(1);
  });

  describe('Asia/Kolkata day/month boundaries', () => {
    it('treats 18:45 UTC (00:15 IST next day) as the next IST day', () => {
      // 2025-01-31T18:45:00Z == 2025-02-01T00:15:00 IST
      const ref = new Date('2025-01-31T18:45:00Z');
      const { start, end } = istDayRange(ref);
      // IST day start 2025-02-01 00:00 == 2025-01-31T18:30:00Z
      expect(start.toISOString()).toBe('2025-01-31T18:30:00.000Z');
      expect(end.toISOString()).toBe('2025-02-01T18:30:00.000Z');
    });

    it('treats 18:15 UTC (23:45 IST) as still the same IST day', () => {
      const ref = new Date('2025-01-31T18:15:00Z'); // 23:45 IST on Jan 31
      const { start } = istDayRange(ref);
      expect(start.toISOString()).toBe('2025-01-30T18:30:00.000Z'); // Jan 31 00:00 IST
    });

    it('computes the IST month range for a UTC instant near month end', () => {
      // 2025-01-31T20:00:00Z == 2025-02-01T01:30 IST -> February in IST.
      const ref = new Date('2025-01-31T20:00:00Z');
      const { start, end } = istMonthRange(ref);
      // Feb 1 00:00 IST == Jan 31 18:30 UTC; Mar 1 00:00 IST == Feb 28 18:30 UTC.
      expect(start.toISOString()).toBe('2025-01-31T18:30:00.000Z');
      expect(end.toISOString()).toBe('2025-02-28T18:30:00.000Z');
    });

    it('assigns an expense at 19:00 UTC to the next IST day in dashboard totals', async () => {
      const acct = await makeAccount(1000000);
      // 2025-06-15T19:00:00Z == 2025-06-16T00:30 IST.
      const txnDate = new Date('2025-06-15T19:00:00Z');
      await recordExpense({ userId, accountId: acct._id, amountPaise: 7000, transactionDate: txnDate });

      // Querying "today" as Jun 15 IST (ref mid-day IST) should NOT see it...
      const jun15Ist = new Date('2025-06-15T06:00:00Z'); // 11:30 IST Jun 15
      expect(await getExpensesTodayPaise(userId, jun15Ist)).toBe(0);
      // ...but querying Jun 16 IST should.
      const jun16Ist = new Date('2025-06-16T06:00:00Z');
      expect(await getExpensesTodayPaise(userId, jun16Ist)).toBe(7000);
    });
  });
});
