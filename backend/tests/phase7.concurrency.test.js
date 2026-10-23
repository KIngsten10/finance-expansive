import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Transaction } from '../src/models/Transaction.js';
import { Expense } from '../src/models/Expense.js';
import { recordExpense } from '../src/services/transaction.service.js';

/**
 * Part 4 concurrency tests against a real replica set. These exercise the
 * atomic transaction path directly (no HTTP) so we can fire many writes in
 * parallel against the same account.
 */
describe('Phase 7 concurrency (replica set)', () => {
  let replset;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replset = await startReplSet();
    await Transaction.init(); // ensure the idempotency index is built
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  async function makeAccount(balancePaise, overrides = {}) {
    return BankAccount.create({
      userId,
      bankName: 'Bank',
      accountName: 'Main',
      openingBalancePaise: balancePaise,
      currentBalancePaise: balancePaise,
      ...overrides,
    });
  }

  it('never allows a negative balance under concurrent over-debits (overdraft off)', async () => {
    const acct = await makeAccount(100000); // ₹1,000

    // Fire 10 concurrent ₹200 expenses (₹2,000 total) against a ₹1,000 account.
    const attempts = Array.from({ length: 10 }, () =>
      recordExpense({ userId, accountId: acct._id, amountPaise: 20000 }).then(
        () => 'ok',
        (err) => err.message
      )
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r === 'ok').length;
    // At most 5 of the ₹200 debits can fit in ₹1,000.
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(succeeded).toBeGreaterThan(0);

    const refreshed = await BankAccount.findById(acct._id);
    // Balance must never go negative.
    expect(refreshed.currentBalancePaise).toBeGreaterThanOrEqual(0);
    // Balance must equal opening - (succeeded * 20000), i.e. ledger-consistent.
    expect(refreshed.currentBalancePaise).toBe(100000 - succeeded * 20000);

    // Posted expense transactions equal the number that succeeded.
    const posted = await Transaction.countDocuments({ userId, type: 'expense', status: 'posted' });
    expect(posted).toBe(succeeded);
  });

  it('concurrent identical idempotency keys create exactly one ledger entry', async () => {
    const acct = await makeAccount(100000);
    const key = 'concurrent-key';

    const attempts = Array.from({ length: 8 }, () =>
      recordExpense({
        userId,
        accountId: acct._id,
        amountPaise: 10000,
        idempotencyKey: key,
      }).then(
        (r) => (r.idempotentReplay ? 'replay' : 'created'),
        (err) => `err:${err.message}`
      )
    );
    const results = await Promise.all(attempts);

    // Exactly one logical create; the rest are replays or lose the unique-index
    // race (both acceptable — neither creates a second posting).
    const created = results.filter((r) => r === 'created').length;
    expect(created).toBeLessThanOrEqual(1);

    // Exactly one posted transaction and one expense for this key's effect.
    const count = await Transaction.countDocuments({ userId, idempotencyKey: key });
    expect(count).toBe(1);
    const expenses = await Expense.countDocuments({ userId });
    expect(expenses).toBe(1);

    // Balance decreased exactly once.
    const refreshed = await BankAccount.findById(acct._id);
    expect(refreshed.currentBalancePaise).toBe(90000);
  });

  it('allows overdraft concurrently only when the account permits it', async () => {
    const acct = await makeAccount(100000, { allowOverdraft: true });
    const attempts = Array.from({ length: 5 }, () =>
      recordExpense({ userId, accountId: acct._id, amountPaise: 50000 }).then(
        () => 'ok',
        (e) => e.message
      )
    );
    const results = await Promise.all(attempts);
    expect(results.every((r) => r === 'ok')).toBe(true);
    const refreshed = await BankAccount.findById(acct._id);
    // 100000 - 5*50000 = -150000, allowed under overdraft.
    expect(refreshed.currentBalancePaise).toBe(-150000);
  });
});
