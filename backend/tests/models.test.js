import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Transaction } from '../src/models/Transaction.js';
import { Loan } from '../src/models/Loan.js';
import { LoanPayment } from '../src/models/LoanPayment.js';
import { Investment } from '../src/models/Investment.js';

describe('financial model validation', () => {
  let replset;
  const userId = new mongoose.Types.ObjectId();
  const acctId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replset = await startReplSet();
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  it('rejects non-integer (floating) monetary values on BankAccount', async () => {
    const acct = new BankAccount({
      userId,
      bankName: 'Test',
      accountName: 'Main',
      openingBalancePaise: 100.5,
      currentBalancePaise: 100.5,
    });
    await expect(acct.validate()).rejects.toThrow(/integer/i);
  });

  it('rejects an invalid account type', async () => {
    const acct = new BankAccount({
      userId,
      bankName: 'Test',
      accountName: 'Main',
      accountType: 'crypto',
      openingBalancePaise: 0,
      currentBalancePaise: 0,
    });
    await expect(acct.validate()).rejects.toThrow(/account type/i);
  });

  it('rejects a negative transaction amount', async () => {
    const txn = new Transaction({
      userId,
      type: 'expense',
      amountPaise: -500,
      sourceAccountId: acctId,
      transactionDate: new Date(),
    });
    await expect(txn.validate()).rejects.toThrow(/positive integer/i);
  });

  it('rejects a zero transaction amount', async () => {
    const txn = new Transaction({
      userId,
      type: 'income',
      amountPaise: 0,
      destinationAccountId: acctId,
      transactionDate: new Date(),
    });
    await expect(txn.validate()).rejects.toThrow(/positive integer/i);
  });

  it('requires a source account for an expense', async () => {
    const txn = new Transaction({
      userId,
      type: 'expense',
      amountPaise: 500,
      transactionDate: new Date(),
    });
    await expect(txn.validate()).rejects.toThrow(/requires a source account/i);
  });

  it('requires a destination account for income', async () => {
    const txn = new Transaction({
      userId,
      type: 'income',
      amountPaise: 500,
      transactionDate: new Date(),
    });
    await expect(txn.validate()).rejects.toThrow(/requires a destination account/i);
  });

  it('rejects a transfer to the same account', async () => {
    const txn = new Transaction({
      userId,
      type: 'transfer',
      amountPaise: 500,
      sourceAccountId: acctId,
      destinationAccountId: acctId,
      transactionDate: new Date(),
    });
    await expect(txn.validate()).rejects.toThrow(/must differ/i);
  });

  it('enforces the idempotency partial unique index per user', async () => {
    await Transaction.init(); // ensure indexes are built
    const base = {
      userId,
      type: 'expense',
      amountPaise: 100,
      sourceAccountId: acctId,
      transactionDate: new Date(),
      idempotencyKey: 'dup-key',
    };
    await Transaction.create(base);
    await expect(Transaction.create({ ...base })).rejects.toThrow();
  });

  it('allows multiple transactions with no idempotency key', async () => {
    await Transaction.init();
    const base = {
      userId,
      type: 'expense',
      amountPaise: 100,
      sourceAccountId: acctId,
      transactionDate: new Date(),
    };
    await Transaction.create(base);
    await expect(Transaction.create({ ...base })).resolves.toBeTruthy();
  });

  it('enforces payment = principal + interest on LoanPayment', async () => {
    const lp = new LoanPayment({
      userId,
      loanId: new mongoose.Types.ObjectId(),
      transactionId: new mongoose.Types.ObjectId(),
      accountId: acctId,
      paymentAmountPaise: 1000,
      principalPaidPaise: 700,
      interestPaidPaise: 200, // 700 + 200 != 1000
      paymentDate: new Date(),
    });
    await expect(lp.validate()).rejects.toThrow(/must equal/i);
  });

  it('accepts a null currentValuePaise on Investment (unknown, not zero)', async () => {
    const inv = new Investment({
      userId,
      name: 'ACME',
      investmentType: 'stock',
      totalInvestedPaise: 100000,
      currentValuePaise: null,
    });
    await expect(inv.validate()).resolves.toBeUndefined();
    expect(inv.currentValuePaise).toBeNull();
  });

  it('rejects a negative outstanding principal on Loan', async () => {
    const loan = new Loan({
      userId,
      lenderName: 'Bank',
      loanName: 'Car',
      originalPrincipalPaise: 100000,
      outstandingPrincipalPaise: -1,
      annualInterestRate: 9,
      startDate: new Date(),
      tenureMonths: 12,
    });
    await expect(loan.validate()).rejects.toThrow(/non-negative/i);
  });
});
