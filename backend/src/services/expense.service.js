import mongoose from 'mongoose';
import { Expense } from '../models/Expense.js';
import { Transaction } from '../models/Transaction.js';
import { BankAccount } from '../models/BankAccount.js';
import { ApiError } from '../utils/ApiError.js';
import { supportsTransactions, withTransaction } from '../config/database.js';
import { recordExpense, reverseTransaction } from './transaction.service.js';
import { istDayRange, istMonthRange } from '../utils/datetime.js';

/**
 * Expense query + correction service. Recording and reversing reuse the Phase 3
 * transaction service; this module adds listing/filtering and the atomic
 * correction (reverse + re-record) workflow.
 */

function assertTransactionsAvailable() {
  if (!supportsTransactions()) {
    throw ApiError.badRequest(
      'Financial writes require a MongoDB replica set (multi-document transactions). ' +
        'See README: "MongoDB replica-set requirements".'
    );
  }
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

/**
 * List expenses for a user with filters + pagination. Returns rows (with the
 * payment account name joined to avoid N+1) plus the total matching amount and
 * pagination metadata.
 *
 * Only expenses whose linked transaction is still `posted` count toward the
 * total (reversed corrections are excluded), but all matching rows are listed
 * with their status so history stays visible.
 */
export async function listExpenses(userId, filters = {}) {
  const {
    startDate,
    endDate,
    category,
    accountId,
    minAmount, // paise
    maxAmount, // paise
    search,
    page = 1,
    limit = 20,
    sort = 'desc',
  } = filters;

  const match = { userId: toObjectId(userId) };

  const dateRange = {};
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid startDate');
    dateRange.$gte = d;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid endDate');
    dateRange.$lte = d;
  }
  if (Object.keys(dateRange).length) match.expenseDate = dateRange;

  if (category) match.category = category;
  if (accountId) {
    if (!mongoose.isValidObjectId(accountId)) throw ApiError.badRequest('Invalid accountId');
    match.accountId = toObjectId(accountId);
  }

  const amountRange = {};
  if (minAmount != null) amountRange.$gte = minAmount;
  if (maxAmount != null) amountRange.$lte = maxAmount;
  if (Object.keys(amountRange).length) match.amountPaise = amountRange;

  if (search) {
    match.$or = [
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;
  const sortDir = sort === 'asc' ? 1 : -1;

  // Join account + transaction status in one pipeline (no N+1).
  const basePipeline = [
    { $match: match },
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: 'transactionId',
        foreignField: '_id',
        as: 'txn',
      },
    },
    { $unwind: { path: '$txn', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        as: 'account',
      },
    },
    { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } },
  ];

  const [rows, countRow, totalRow] = await Promise.all([
    Expense.aggregate([
      ...basePipeline,
      { $sort: { expenseDate: sortDir, _id: sortDir } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          amountPaise: 1,
          category: 1,
          description: 1,
          expenseDate: 1,
          accountId: 1,
          transactionId: 1,
          accountName: '$account.accountName',
          bankName: '$account.bankName',
          status: '$txn.status',
        },
      },
    ]),
    Expense.aggregate([...basePipeline, { $count: 'count' }]),
    // Total amount of POSTED matching expenses only.
    Expense.aggregate([
      ...basePipeline,
      { $match: { 'txn.status': 'posted' } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]),
  ]);

  const totalCount = countRow[0]?.count ?? 0;

  return {
    rows,
    totalMatchingAmountPaise: totalRow[0]?.total ?? 0,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
    },
  };
}

/** Get one expense (with its transaction) owned by the user. */
export async function getExpense(userId, expenseId) {
  if (!mongoose.isValidObjectId(expenseId)) throw ApiError.badRequest('Invalid expense id');
  const expense = await Expense.findOne({ _id: expenseId, userId });
  if (!expense) throw ApiError.notFound('Expense not found');
  const transaction = await Transaction.findOne({ _id: expense.transactionId, userId });
  return { expense, transaction };
}

/**
 * Reverse an expense exactly once by reversing its backing transaction.
 * Restores the account balance; preserves the original records for audit.
 */
export async function reverseExpense(userId, expenseId, reason) {
  const { expense } = await getExpense(userId, expenseId);
  return reverseTransaction({ userId, transactionId: expense.transactionId, reason });
}

/**
 * Correct an expense: atomically reverse the original and record a replacement
 * with the corrected fields. Both the reversal and the new expense are
 * committed together; if anything fails, no partial balance change remains.
 * The original expense/transaction are preserved (the original transaction is
 * marked 'reversed').
 *
 * Reuses the transaction service primitives but runs them inside a SINGLE outer
 * session so the whole correction is atomic. To avoid double-processing, the
 * original must still be 'posted'.
 */
export async function correctExpense(userId, expenseId, corrections = {}) {
  assertTransactionsAvailable();

  return withTransaction(async (session) => {
    const original = await Expense.findOne({ _id: expenseId, userId }).session(session);
    if (!original) throw ApiError.notFound('Expense not found');

    const originalTxn = await Transaction.findOne({
      _id: original.transactionId,
      userId,
    }).session(session);
    if (!originalTxn) throw ApiError.notFound('Linked transaction not found');
    if (originalTxn.status !== 'posted') {
      throw ApiError.conflict('Expense has already been reversed or corrected');
    }

    // --- 1 & 2: reverse the original effect (credit the source account back) ---
    const originalAccount = await BankAccount.findOne({
      _id: originalTxn.sourceAccountId,
      userId,
    }).session(session);
    if (!originalAccount) throw ApiError.notFound('Original account not found');
    originalAccount.currentBalancePaise += originalTxn.amountPaise; // undo debit
    await originalAccount.save({ session });

    const [reversal] = await Transaction.create(
      [
        {
          userId,
          type: originalTxn.type,
          amountPaise: originalTxn.amountPaise,
          sourceAccountId: originalTxn.sourceAccountId,
          category: originalTxn.category,
          description: `Reversal (correction) of ${originalTxn._id}`,
          transactionDate: new Date(),
          status: 'posted',
          referenceType: 'Reversal',
          reversalOfId: originalTxn._id,
          createdBy: userId,
        },
      ],
      { session }
    );
    originalTxn.status = 'reversed';
    originalTxn.reversedById = reversal._id;
    await originalTxn.save({ session });

    // --- 3 & 4: apply the corrected expense ---
    const newAmountPaise =
      corrections.amountPaise != null ? corrections.amountPaise : original.amountPaise;
    if (!Number.isInteger(newAmountPaise) || newAmountPaise <= 0) {
      throw ApiError.badRequest('Corrected amount must be a positive integer (paise)');
    }
    const newAccountId = corrections.accountId || original.accountId;
    const newCategory = corrections.category ?? original.category;
    const newDescription =
      corrections.description !== undefined ? corrections.description : original.description;
    const newDate = corrections.expenseDate ? new Date(corrections.expenseDate) : original.expenseDate;

    const targetAccount = await BankAccount.findOne({ _id: newAccountId, userId }).session(session);
    if (!targetAccount) throw ApiError.notFound('Target account not found');
    if (!targetAccount.isActive) throw ApiError.badRequest('Target account is inactive');

    const next = targetAccount.currentBalancePaise - newAmountPaise;
    if (next < 0 && !targetAccount.allowOverdraft) {
      throw ApiError.badRequest('Insufficient funds in the selected account');
    }
    targetAccount.currentBalancePaise = next;
    await targetAccount.save({ session });

    const [newTxn] = await Transaction.create(
      [
        {
          userId,
          type: 'expense',
          amountPaise: newAmountPaise,
          sourceAccountId: targetAccount._id,
          category: newCategory,
          description: newDescription,
          transactionDate: newDate,
          referenceType: 'Expense',
          status: 'posted',
          createdBy: userId,
        },
      ],
      { session }
    );

    const [newExpense] = await Expense.create(
      [
        {
          userId,
          transactionId: newTxn._id,
          accountId: targetAccount._id,
          amountPaise: newAmountPaise,
          category: newCategory || 'uncategorized',
          description: newDescription,
          expenseDate: newDate,
        },
      ],
      { session }
    );
    newTxn.referenceId = newExpense._id;
    await newTxn.save({ session });

    return { reversedExpenseId: original._id, newExpense, newTransaction: newTxn };
  });
}

/** Re-export for controller convenience. */
export { recordExpense, istDayRange, istMonthRange };
