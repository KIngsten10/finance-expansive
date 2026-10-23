import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Transaction } from '../src/models/Transaction.js';
import { Expense } from '../src/models/Expense.js';
import {
  recordExpense,
  recordIncome,
  recordTransfer,
  recordAdjustment,
  reverseTransaction,
} from '../src/services/transaction.service.js';

async function makeAccount(userId, balancePaise, overrides = {}) {
  return BankAccount.create({
    userId,
    bankName: 'Test Bank',
    accountName: 'Account',
    openingBalancePaise: balancePaise,
    currentBalancePaise: balancePaise,
    ...overrides,
  });
}

describe('transaction service (replica set)', () => {
  let replset;
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replset = await startReplSet();
    await Transaction.init(); // build indexes incl. idempotency
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  it('records an expense and decreases the account balance', async () => {
    const acct = await makeAccount(userId, 100000); // ₹1,000
    const { transaction, expense } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 25050, // ₹250.50
      category: 'food',
      transactionDate: new Date(),
    });

    expect(transaction.type).toBe('expense');
    expect(expense.amountPaise).toBe(25050);
    expect(transaction.referenceId.toString()).toBe(expense._id.toString());

    const refreshed = await BankAccount.findById(acct._id);
    expect(refreshed.currentBalancePaise).toBe(74950);
  });

  it('records income and increases the account balance', async () => {
    const acct = await makeAccount(userId, 50000);
    await recordIncome({ userId, accountId: acct._id, amountPaise: 20000 });
    const refreshed = await BankAccount.findById(acct._id);
    expect(refreshed.currentBalancePaise).toBe(70000);
  });

  it('transfers between two accounts of the same user', async () => {
    const a = await makeAccount(userId, 100000);
    const b = await makeAccount(userId, 0);
    const { transaction } = await recordTransfer({
      userId,
      sourceAccountId: a._id,
      destinationAccountId: b._id,
      amountPaise: 40000,
    });
    expect(transaction.type).toBe('transfer');
    expect((await BankAccount.findById(a._id)).currentBalancePaise).toBe(60000);
    expect((await BankAccount.findById(b._id)).currentBalancePaise).toBe(40000);
  });

  it('rejects an expense that would overdraw when overdraft is disabled', async () => {
    const acct = await makeAccount(userId, 1000);
    await expect(
      recordExpense({ userId, accountId: acct._id, amountPaise: 5000 })
    ).rejects.toThrow(/insufficient funds/i);
    // Balance unchanged.
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(1000);
  });

  it('allows overdraft when the account permits it', async () => {
    const acct = await makeAccount(userId, 1000, { allowOverdraft: true });
    await recordExpense({ userId, accountId: acct._id, amountPaise: 5000 });
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(-4000);
  });

  it('rejects a negative / zero amount', async () => {
    const acct = await makeAccount(userId, 100000);
    await expect(
      recordExpense({ userId, accountId: acct._id, amountPaise: -1 })
    ).rejects.toThrow(/positive integer/i);
    await expect(
      recordExpense({ userId, accountId: acct._id, amountPaise: 0 })
    ).rejects.toThrow(/positive integer/i);
  });

  it('replays the same result for a duplicate idempotency key', async () => {
    const acct = await makeAccount(userId, 100000);
    const key = 'idem-1';
    const first = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 10000,
      idempotencyKey: key,
    });
    const second = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 10000,
      idempotencyKey: key,
    });
    expect(second.idempotentReplay).toBe(true);
    expect(second.transaction._id.toString()).toBe(first.transaction._id.toString());
    // Balance decreased only once.
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(90000);
    expect(await Transaction.countDocuments({ userId })).toBe(1);
  });

  it('rejects an idempotency key reused with a different payload', async () => {
    const acct = await makeAccount(userId, 100000);
    const key = 'idem-2';
    await recordExpense({ userId, accountId: acct._id, amountPaise: 10000, idempotencyKey: key });
    await expect(
      recordExpense({ userId, accountId: acct._id, amountPaise: 99999, idempotencyKey: key })
    ).rejects.toThrow(/different request payload/i);
  });

  it('rolls back all writes when a later step fails (atomicity)', async () => {
    const a = await makeAccount(userId, 100000);
    // Destination account belongs to another user -> ownership load fails
    // AFTER the source debit has been staged; the transaction must roll back.
    const foreign = await makeAccount(otherUserId, 0);
    await expect(
      recordTransfer({
        userId,
        sourceAccountId: a._id,
        destinationAccountId: foreign._id,
        amountPaise: 10000,
      })
    ).rejects.toThrow(/not found/i);

    // Source balance unchanged and no transaction persisted.
    expect((await BankAccount.findById(a._id)).currentBalancePaise).toBe(100000);
    expect(await Transaction.countDocuments({ userId })).toBe(0);
  });

  it('records a balance adjustment with a required reason', async () => {
    const acct = await makeAccount(userId, 100000);
    await expect(
      recordAdjustment({ userId, accountId: acct._id, deltaPaise: -5000, reason: '' })
    ).rejects.toThrow(/reason is required/i);

    const { transaction } = await recordAdjustment({
      userId,
      accountId: acct._id,
      deltaPaise: -5000,
      reason: 'Bank fee correction',
    });
    expect(transaction.type).toBe('adjustment');
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(95000);
  });

  it('reverses a posted transaction and restores the balance', async () => {
    const acct = await makeAccount(userId, 100000);
    const { transaction } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 30000,
    });
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(70000);

    const { original, reversal } = await reverseTransaction({
      userId,
      transactionId: transaction._id,
      reason: 'mistake',
    });
    expect(original.status).toBe('reversed');
    expect(reversal.reversalOfId.toString()).toBe(transaction._id.toString());
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(100000);
  });

  it('prevents reversing the same transaction twice', async () => {
    const acct = await makeAccount(userId, 100000);
    const { transaction } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 30000,
    });
    await reverseTransaction({ userId, transactionId: transaction._id });
    await expect(
      reverseTransaction({ userId, transactionId: transaction._id })
    ).rejects.toThrow(/already been reversed/i);
    // Balance not double-restored.
    expect((await BankAccount.findById(acct._id)).currentBalancePaise).toBe(100000);
  });

  it('does not physically delete the reversed transaction (audit trail)', async () => {
    const acct = await makeAccount(userId, 100000);
    const { transaction } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 30000,
    });
    await reverseTransaction({ userId, transactionId: transaction._id });
    const stillThere = await Transaction.findById(transaction._id);
    expect(stillThere).not.toBeNull();
    expect(stillThere.status).toBe('reversed');
    // One original + one reversal.
    expect(await Transaction.countDocuments({ userId })).toBe(2);
  });

  it('prevents cross-user access to accounts', async () => {
    const foreign = await makeAccount(otherUserId, 100000);
    // userId tries to spend from otherUserId's account.
    await expect(
      recordExpense({ userId, accountId: foreign._id, amountPaise: 1000 })
    ).rejects.toThrow(/not found/i);
    expect((await BankAccount.findById(foreign._id)).currentBalancePaise).toBe(100000);
  });

  it('keeps the expense record linked to its transaction', async () => {
    const acct = await makeAccount(userId, 100000);
    const { transaction, expense } = await recordExpense({
      userId,
      accountId: acct._id,
      amountPaise: 1000,
    });
    const linked = await Expense.findOne({ transactionId: transaction._id });
    expect(linked._id.toString()).toBe(expense._id.toString());
  });
});
