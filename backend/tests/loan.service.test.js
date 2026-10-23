import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Loan } from '../src/models/Loan.js';
import { Expense } from '../src/models/Expense.js';
import { recordLoanPayment } from '../src/services/loan.service.js';

describe('loan payment accounting (replica set)', () => {
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

  async function setup() {
    const account = await BankAccount.create({
      userId,
      bankName: 'Bank',
      accountName: 'Main',
      openingBalancePaise: 1000000, // ₹10,000
      currentBalancePaise: 1000000,
    });
    const loan = await Loan.create({
      userId,
      lenderName: 'HDFC',
      loanName: 'Car Loan',
      originalPrincipalPaise: 500000, // ₹5,000
      outstandingPrincipalPaise: 500000,
      annualInterestRate: 9,
      startDate: new Date(),
      tenureMonths: 12,
    });
    return { account, loan };
  }

  it('splits a payment: debits bank by total, reduces principal, records interest as expense', async () => {
    const { account, loan } = await setup();

    const { loan: updatedLoan } = await recordLoanPayment({
      userId,
      loanId: loan._id,
      accountId: account._id,
      principalPaidPaise: 40000, // ₹400
      interestPaidPaise: 10000, // ₹100
      paymentDate: new Date(),
    });

    // Bank debited by total 50000.
    expect((await BankAccount.findById(account._id)).currentBalancePaise).toBe(950000);
    // Loan principal reduced by 40000 only.
    expect(updatedLoan.outstandingPrincipalPaise).toBe(460000);
    // Interest (10000) recorded as an expense.
    const interestExpense = await Expense.findOne({ userId, category: 'loan_interest' });
    expect(interestExpense).not.toBeNull();
    expect(interestExpense.amountPaise).toBe(10000);
  });

  it('does NOT record principal as an expense (no double counting)', async () => {
    const { account, loan } = await setup();
    await recordLoanPayment({
      userId,
      loanId: loan._id,
      accountId: account._id,
      principalPaidPaise: 40000,
      interestPaidPaise: 0,
      paymentDate: new Date(),
    });
    // With zero interest, there must be no expense at all.
    expect(await Expense.countDocuments({ userId })).toBe(0);
  });

  it('rejects principal exceeding outstanding without an adjustment', async () => {
    const { account, loan } = await setup();
    await expect(
      recordLoanPayment({
        userId,
        loanId: loan._id,
        accountId: account._id,
        principalPaidPaise: 600000, // > 500000 outstanding
        interestPaidPaise: 0,
      })
    ).rejects.toThrow(/exceeds outstanding/i);
  });

  it('closes the loan when principal reaches zero', async () => {
    const { account, loan } = await setup();
    const { loan: updated } = await recordLoanPayment({
      userId,
      loanId: loan._id,
      accountId: account._id,
      principalPaidPaise: 500000,
      interestPaidPaise: 0,
    });
    expect(updated.outstandingPrincipalPaise).toBe(0);
    expect(updated.status).toBe('closed');
  });
});
