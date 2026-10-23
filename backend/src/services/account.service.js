import mongoose from 'mongoose';
import { BankAccount, ACCOUNT_TYPES } from '../models/BankAccount.js';
import { Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { supportsTransactions, withTransaction } from '../config/database.js';

/**
 * Bank account service. Account creation with a non-zero opening balance also
 * writes an opening-balance ledger entry (type 'income', category
 * 'opening_balance') ATOMICALLY with the account, so the ledger and the stored
 * balance are consistent and the opening balance is visible in history. An
 * opening balance is NOT recorded as an ordinary expense/income spend.
 */

function assertTransactionsAvailable() {
  if (!supportsTransactions()) {
    throw ApiError.badRequest(
      'Financial writes require a MongoDB replica set (multi-document transactions). ' +
        'See README: "MongoDB replica-set requirements".'
    );
  }
}

const SUPPORTED_CURRENCIES = new Set(['INR']);

export async function createAccount({
  userId,
  bankName,
  accountName,
  accountType = 'savings',
  currency = 'INR',
  openingBalancePaise,
}) {
  assertTransactionsAvailable();

  if (!bankName || !bankName.trim()) throw ApiError.badRequest('Bank name is required');
  if (!accountName || !accountName.trim()) throw ApiError.badRequest('Account name is required');
  if (!ACCOUNT_TYPES.includes(accountType)) {
    throw ApiError.badRequest(`Account type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }
  const normalizedCurrency = String(currency || 'INR').toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
    throw ApiError.badRequest('Only INR is currently supported');
  }
  if (!Number.isInteger(openingBalancePaise) || openingBalancePaise < 0) {
    throw ApiError.badRequest('Opening balance must be a non-negative amount');
  }

  return withTransaction(async (session) => {
    const [account] = await BankAccount.create(
      [
        {
          userId,
          bankName: bankName.trim(),
          accountName: accountName.trim(),
          accountType,
          currency: normalizedCurrency,
          openingBalancePaise,
          currentBalancePaise: openingBalancePaise,
          isActive: true,
        },
      ],
      { session }
    );

    // Record the opening balance in the ledger (does not re-apply to balance;
    // currentBalancePaise already starts at the opening balance).
    if (openingBalancePaise > 0) {
      await Transaction.create(
        [
          {
            userId,
            type: 'income',
            amountPaise: openingBalancePaise,
            destinationAccountId: account._id,
            category: 'opening_balance',
            description: 'Opening balance',
            transactionDate: account.createdAt || new Date(),
            referenceType: 'OpeningBalance',
            status: 'posted',
            createdBy: userId,
          },
        ],
        { session }
      );
    }

    return account;
  });
}

/** List the user's accounts (newest first). */
export async function listAccounts(userId) {
  return BankAccount.find({ userId }).sort({ createdAt: -1 });
}

/** Load one account owned by the user, or throw 404. */
export async function getAccount(userId, accountId) {
  if (!mongoose.isValidObjectId(accountId)) {
    throw ApiError.badRequest('A valid account id is required');
  }
  const account = await BankAccount.findOne({ _id: accountId, userId });
  if (!account) throw ApiError.notFound('Bank account not found');
  return account;
}

/**
 * Update safe METADATA only. Balance fields can never be set here — they change
 * only through the ledger services. Unknown/forbidden fields are ignored
 * (mass-assignment guard).
 */
export async function updateAccountMetadata(userId, accountId, updates = {}) {
  const account = await getAccount(userId, accountId);

  const allowed = ['bankName', 'accountName', 'accountType', 'isActive'];
  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    if (key === 'accountType' && !ACCOUNT_TYPES.includes(updates[key])) {
      throw ApiError.badRequest(`Account type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
    }
    if ((key === 'bankName' || key === 'accountName') && !String(updates[key]).trim()) {
      throw ApiError.badRequest(`${key} cannot be empty`);
    }
    account[key] = key === 'isActive' ? Boolean(updates[key]) : updates[key];
  }
  await account.save();
  return account;
}

/**
 * Deactivate an account instead of physically deleting it, preserving its
 * financial history. Accounts with any ledger history must not be hard-deleted.
 */
export async function deactivateAccount(userId, accountId) {
  const account = await getAccount(userId, accountId);
  account.isActive = false;
  await account.save();
  return account;
}
