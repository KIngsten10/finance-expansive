import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { Transaction } from '../models/Transaction.js';
import { Expense } from '../models/Expense.js';
import { ApiError } from '../utils/ApiError.js';
import { supportsTransactions, withTransaction } from '../config/database.js';

/**
 * Centralized financial transaction service. ALL balance changes flow through
 * here so the Transaction ledger and account balances never diverge.
 *
 * Atomicity policy: financial writes REQUIRE MongoDB multi-document
 * transactions (a replica set). If the deployment is standalone we refuse the
 * write with a clear configuration error rather than performing unsafe,
 * non-atomic updates. See README "MongoDB replica-set requirements".
 */

function assertTransactionsAvailable() {
  if (!supportsTransactions()) {
    throw ApiError.badRequest(
      'Financial writes require a MongoDB replica set (multi-document transactions). ' +
      'The current deployment is standalone. See README: "MongoDB replica-set requirements".'
    );
  }
}

function assertPositiveIntegerPaise(amountPaise, field = 'amountPaise') {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw ApiError.badRequest(`${field} must be a positive integer (paise)`);
  }
}

/**
 * Load an account that MUST belong to `userId`. Throws 404 (not 403) when the
 * account is missing or owned by someone else, so we never reveal that another
 * user's account id exists.
 */
async function loadOwnedAccount(accountId, userId, session) {
  if (!accountId || !mongoose.isValidObjectId(accountId)) {
    throw ApiError.badRequest('A valid account id is required');
  }
  const account = await BankAccount.findOne({ _id: accountId, userId }).session(session);
  if (!account) {
    throw ApiError.notFound('Bank account not found');
  }
  return account;
}

/**
 * Idempotency gate. If a transaction with this (userId, idempotencyKey) already
 * exists, return it (same payload) or reject (different payload). Returns null
 * when there is no key or no prior record.
 */
async function findIdempotent(userId, idempotencyKey, expected, session) {
  if (!idempotencyKey) return null;
  const existing = await Transaction.findOne({ userId, idempotencyKey }).session(session);
  if (!existing) return null;

  // Compare the parts of the payload that define the financial effect.
  const mismatch =
    existing.type !== expected.type ||
    existing.amountPaise !== expected.amountPaise ||
    String(existing.sourceAccountId || '') !== String(expected.sourceAccountId || '') ||
    String(existing.destinationAccountId || '') !== String(expected.destinationAccountId || '');

  if (mismatch) {
    throw ApiError.conflict(
      'Idempotency key was already used with a different request payload'
    );
  }
  return existing;
}

/** Apply a signed delta (paise) to an account balance, enforcing overdraft rules. */
function applyDelta(account, deltaPaise) {
  const next = account.currentBalancePaise + deltaPaise;
  if (next < 0 && !account.allowOverdraft) {
    throw ApiError.badRequest('Insufficient funds in the selected account');
  }
  account.currentBalancePaise = next;
}

/**
 * Record an EXPENSE: money leaves `accountId`, a Transaction (type 'expense')
 * and a linked Expense record are created. Does not touch loans/investments.
 */
export async function recordExpense({
  userId,
  accountId,
  amountPaise,
  category,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise);
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    const expected = { type: 'expense', amountPaise, sourceAccountId: accountId };
    const prior = await findIdempotent(userId, idempotencyKey, expected, session);
    if (prior) return { transaction: prior, idempotentReplay: true };

    const account = await loadOwnedAccount(accountId, userId, session);
    applyDelta(account, -amountPaise);
    await account.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'expense',
          amountPaise,
          sourceAccountId: account._id,
          category,
          description,
          transactionDate: date,
          referenceType: 'Expense',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    const [expense] = await Expense.create(
      [
        {
          userId,
          transactionId: txn._id,
          accountId: account._id,
          amountPaise,
          category: category || 'uncategorized',
          description,
          expenseDate: date,
        },
      ],
      { session }
    );

    txn.referenceId = expense._id;
    await txn.save({ session });

    return { transaction: txn, expense, idempotentReplay: false };
  });
}

/** Record INCOME: money enters `accountId`. */
export async function recordIncome({
  userId,
  accountId,
  amountPaise,
  category,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise);
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    const expected = { type: 'income', amountPaise, destinationAccountId: accountId };
    const prior = await findIdempotent(userId, idempotencyKey, expected, session);
    if (prior) return { transaction: prior, idempotentReplay: true };

    const account = await loadOwnedAccount(accountId, userId, session);
    applyDelta(account, amountPaise);
    await account.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'income',
          amountPaise,
          destinationAccountId: account._id,
          category,
          description,
          transactionDate: date,
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    return { transaction: txn, idempotentReplay: false };
  });
}

/**
 * TRANSFER between two of the SAME user's accounts. Never counted as income or
 * expense. Rejects same-account transfers and (implicitly, via ownership) any
 * cross-user attempt.
 */
export async function recordTransfer({
  userId,
  sourceAccountId,
  destinationAccountId,
  amountPaise,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise);
  if (String(sourceAccountId) === String(destinationAccountId)) {
    throw ApiError.badRequest('Transfer source and destination accounts must differ');
  }
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    const expected = { type: 'transfer', amountPaise, sourceAccountId, destinationAccountId };
    const prior = await findIdempotent(userId, idempotencyKey, expected, session);
    if (prior) return { transaction: prior, idempotentReplay: true };

    const source = await loadOwnedAccount(sourceAccountId, userId, session);
    const destination = await loadOwnedAccount(destinationAccountId, userId, session);

    applyDelta(source, -amountPaise);
    applyDelta(destination, amountPaise);
    await source.save({ session });
    await destination.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'transfer',
          amountPaise,
          sourceAccountId: source._id,
          destinationAccountId: destination._id,
          description,
          transactionDate: date,
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    return { transaction: txn, idempotentReplay: false };
  });
}

/**
 * BALANCE ADJUSTMENT: a documented correction. Requires a reason. A positive
 * `deltaPaise` increases the balance, negative decreases it. Recorded in the
 * ledger as type 'adjustment' (never a silent overwrite).
 */
export async function recordAdjustment({
  userId,
  accountId,
  deltaPaise,
  reason,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  if (!Number.isInteger(deltaPaise) || deltaPaise === 0) {
    throw ApiError.badRequest('deltaPaise must be a non-zero integer (paise)');
  }
  if (!reason || !reason.trim()) {
    throw ApiError.badRequest('A reason is required for a balance adjustment');
  }
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    const expected = {
      type: 'adjustment',
      amountPaise: Math.abs(deltaPaise),
      sourceAccountId: accountId,
    };
    const prior = await findIdempotent(userId, idempotencyKey, expected, session);
    if (prior) return { transaction: prior, idempotentReplay: true };

    const account = await loadOwnedAccount(accountId, userId, session);
    applyDelta(account, deltaPaise);
    await account.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'adjustment',
          amountPaise: Math.abs(deltaPaise),
          // Direction is encoded by which account field is set.
          sourceAccountId: deltaPaise < 0 ? account._id : undefined,
          destinationAccountId: deltaPaise > 0 ? account._id : undefined,
          category: 'adjustment',
          description: reason.trim(),
          transactionDate: date,
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    return { transaction: txn, idempotentReplay: false };
  });
}

/**
 * Compute the per-account balance deltas that a posted transaction applied, so
 * a reversal can undo exactly those effects.
 * Returns a map of accountId -> delta the ORIGINAL applied.
 */
function originalEffects(txn) {
  const effects = [];
  switch (txn.type) {
    case 'expense':
    case 'loan_payment':
    case 'investment_purchase':
      effects.push({ accountId: txn.sourceAccountId, delta: -txn.amountPaise });
      break;
    case 'income':
    case 'investment_sale':
      effects.push({ accountId: txn.destinationAccountId, delta: txn.amountPaise });
      break;
    case 'transfer':
      effects.push({ accountId: txn.sourceAccountId, delta: -txn.amountPaise });
      effects.push({ accountId: txn.destinationAccountId, delta: txn.amountPaise });
      break;
    case 'adjustment':
      if (txn.sourceAccountId) effects.push({ accountId: txn.sourceAccountId, delta: -txn.amountPaise });
      if (txn.destinationAccountId)
        effects.push({ accountId: txn.destinationAccountId, delta: txn.amountPaise });
      break;
    default:
      break;
  }
  return effects;
}

/**
 * REVERSE a posted transaction. Restores the original balance effects, marks
 * the original as 'reversed', and creates a linked reversing Transaction.
 * A transaction can be reversed at most once; reversals cannot be reversed.
 * The original is preserved for audit (never deleted).
 */
export async function reverseTransaction({ userId, transactionId, reason }) {
  assertTransactionsAvailable();
  if (!mongoose.isValidObjectId(transactionId)) {
    throw ApiError.badRequest('A valid transaction id is required');
  }

  return withTransaction(async (session) => {
    const original = await Transaction.findOne({ _id: transactionId, userId }).session(session);
    if (!original) {
      throw ApiError.notFound('Transaction not found');
    }
    // Domain transactions (loan payments, investment activity) carry extra state
    // — loan principal, investment holdings/cost basis — that this generic
    // ledger reversal does NOT know how to restore. They must be reversed
    // through their dedicated services. Refuse here to prevent silently leaving
    // domain state inconsistent while only the bank balance is restored.
    if (['loan_payment', 'investment_purchase', 'investment_sale'].includes(original.type)) {
      throw ApiError.badRequest(
        `A "${original.type}" transaction must be reversed through its own module ` +
        '(loan payment reversal or investment transaction reversal), not the generic ledger reversal.'
      );
    }
    if (original.status === 'reversed' || original.reversedById) {
      throw ApiError.conflict('Transaction has already been reversed');
    }
    if (original.reversalOfId) {
      throw ApiError.badRequest('A reversal transaction cannot itself be reversed');
    }

    // Undo the original balance effects (overdraft check skipped: reversing must
    // always be allowed to restore prior state).
    for (const { accountId, delta } of originalEffects(original)) {
      const account = await loadOwnedAccount(accountId, userId, session);
      account.currentBalancePaise -= delta; // subtract the original delta
      await account.save({ session });
    }

    // The reversing entry keeps the SAME type and account fields as the
    // original so the per-type account-field rules hold. Its reversing nature
    // is captured by `reversalOfId`; the balance restoration above already
    // undoes the original effects (so totals must exclude reversal entries,
    // which the dashboard does by other means — see below).
    const [reversal] = await Transaction.create(
      [
        {
          userId,
          type: original.type,
          amountPaise: original.amountPaise,
          sourceAccountId: original.sourceAccountId,
          destinationAccountId: original.destinationAccountId,
          category: original.category,
          description: reason?.trim() || `Reversal of ${original._id}`,
          transactionDate: new Date(),
          status: 'posted',
          referenceType: 'Reversal',
          reversalOfId: original._id,
          createdBy: userId,
        },
      ],
      { session }
    );

    original.status = 'reversed';
    original.reversedById = reversal._id;
    await original.save({ session });

    return { original, reversal };
  });
}
