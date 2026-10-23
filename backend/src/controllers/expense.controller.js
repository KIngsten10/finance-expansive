import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { toPaise, paiseToRupeesNumber } from '../utils/money.js';
import { serializeExpenseRow, serializeAccount, serializeTransactionRow } from '../utils/serialize.js';
import { recordExpense } from '../services/transaction.service.js';
import { getAccount } from '../services/account.service.js';
import {
  listExpenses,
  getExpense,
  reverseExpense,
  correctExpense,
} from '../services/expense.service.js';

/** Read an idempotency key from the header or body (header takes precedence). */
function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey || undefined;
}

/** POST /api/expenses */
export const create = asyncHandler(async (req, res) => {
  const { amount, category, accountId, description, expenseDate } = req.body ?? {};

  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw ApiError.badRequest('A positive amount is required');
  }
  if (!category || !String(category).trim()) throw ApiError.badRequest('Category is required');
  if (!accountId) throw ApiError.badRequest('A payment account is required');

  let date;
  if (expenseDate) {
    date = new Date(expenseDate);
    if (Number.isNaN(date.getTime())) throw ApiError.badRequest('Invalid expense date');
  } else {
    date = new Date();
  }

  // Ownership + active check before touching the ledger.
  const account = await getAccount(req.userId, accountId);
  if (!account.isActive) throw ApiError.badRequest('The selected account is inactive');

  const { transaction, expense, idempotentReplay } = await recordExpense({
    userId: req.userId,
    accountId,
    amountPaise: toPaise(amount),
    category: String(category).trim(),
    description,
    transactionDate: date,
    idempotencyKey: idempotencyKey(req),
  });

  // Reload the account to return the updated balance.
  const refreshed = await getAccount(req.userId, accountId);

  sendSuccess(
    res,
    {
      expense: expense
        ? serializeExpenseRow({
            ...expense.toObject(),
            accountName: refreshed.accountName,
            bankName: refreshed.bankName,
            status: transaction.status,
          })
        : null,
      transaction: serializeTransactionRow(transaction),
      account: serializeAccount(refreshed),
      idempotentReplay,
    },
    { status: idempotentReplay ? 200 : 201, message: 'Expense recorded' }
  );
});

/** GET /api/expenses */
export const list = asyncHandler(async (req, res) => {
  const {
    startDate,
    endDate,
    category,
    accountId,
    minAmount,
    maxAmount,
    search,
    page,
    limit,
    sort,
  } = req.query;

  const result = await listExpenses(req.userId, {
    startDate,
    endDate,
    category,
    accountId,
    minAmount: minAmount != null ? toPaise(minAmount) : undefined,
    maxAmount: maxAmount != null ? toPaise(maxAmount) : undefined,
    search,
    page,
    limit,
    sort,
  });

  sendSuccess(res, {
    expenses: result.rows.map(serializeExpenseRow),
    totalMatchingAmount: paiseToRupeesNumber(result.totalMatchingAmountPaise),
    pagination: result.pagination,
  });
});

/** GET /api/expenses/:id */
export const getOne = asyncHandler(async (req, res) => {
  const { expense, transaction } = await getExpense(req.userId, req.params.id);
  sendSuccess(res, {
    expense: serializeExpenseRow({
      ...expense.toObject(),
      status: transaction?.status,
    }),
    transaction: transaction ? serializeTransactionRow(transaction) : null,
  });
});

/** PATCH /api/expenses/:id — safe correction (reverse + replace, atomic) */
export const correct = asyncHandler(async (req, res) => {
  const { amount, category, accountId, description, expenseDate } = req.body ?? {};

  const corrections = {};
  if (amount !== undefined) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      throw ApiError.badRequest('Corrected amount must be positive');
    }
    corrections.amountPaise = toPaise(amount);
  }
  if (category !== undefined) corrections.category = String(category).trim();
  if (accountId !== undefined) corrections.accountId = accountId;
  if (description !== undefined) corrections.description = description;
  if (expenseDate !== undefined) {
    const d = new Date(expenseDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid expense date');
    corrections.expenseDate = d;
  }

  const result = await correctExpense(req.userId, req.params.id, corrections);
  const refreshed = await getAccount(req.userId, result.newExpense.accountId);

  sendSuccess(
    res,
    {
      expense: serializeExpenseRow({
        ...result.newExpense.toObject(),
        accountName: refreshed.accountName,
        bankName: refreshed.bankName,
        status: 'posted',
      }),
      account: serializeAccount(refreshed),
      reversedExpenseId: result.reversedExpenseId.toString(),
    },
    { message: 'Expense corrected' }
  );
});

/** DELETE /api/expenses/:id — controlled reversal (no physical delete) */
export const remove = asyncHandler(async (req, res) => {
  const { expense } = await getExpense(req.userId, req.params.id);
  await reverseExpense(req.userId, req.params.id, 'Expense deleted (reversed)');
  const refreshed = await getAccount(req.userId, expense.accountId);
  sendSuccess(res, { account: serializeAccount(refreshed) }, {
    message: 'Expense reversed (records preserved for audit)',
  });
});

/** POST /api/expenses/:id/reverse */
export const reverse = asyncHandler(async (req, res) => {
  const { reason } = req.body ?? {};
  const { expense } = await getExpense(req.userId, req.params.id);
  await reverseExpense(req.userId, req.params.id, reason || 'Expense reversed');
  const refreshed = await getAccount(req.userId, expense.accountId);
  sendSuccess(res, { account: serializeAccount(refreshed) }, { message: 'Expense reversed' });
});
