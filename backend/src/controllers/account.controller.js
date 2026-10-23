import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { toPaise } from '../utils/money.js';
import { serializeAccount } from '../utils/serialize.js';
import {
  createAccount,
  listAccounts,
  getAccount,
  updateAccountMetadata,
  deactivateAccount,
} from '../services/account.service.js';
import { listTransactions } from '../services/transactionQuery.service.js';
import { serializeTransactionRow } from '../utils/serialize.js';

/** GET /api/bank-accounts */
export const list = asyncHandler(async (req, res) => {
  const accounts = await listAccounts(req.userId);
  sendSuccess(res, { accounts: accounts.map(serializeAccount) });
});

/** POST /api/bank-accounts */
export const create = asyncHandler(async (req, res) => {
  const { bankName, accountName, accountType, currency, openingBalance } = req.body ?? {};

  if (openingBalance != null && !Number.isFinite(Number(openingBalance))) {
    throw ApiError.badRequest('Opening balance must be a number');
  }
  const openingBalancePaise = openingBalance != null ? toPaise(openingBalance) : 0;

  const account = await createAccount({
    userId: req.userId,
    bankName,
    accountName,
    accountType,
    currency,
    openingBalancePaise,
  });

  sendSuccess(res, { account: serializeAccount(account) }, {
    status: 201,
    message: 'Bank account created',
  });
});

/** GET /api/bank-accounts/:id */
export const getOne = asyncHandler(async (req, res) => {
  const account = await getAccount(req.userId, req.params.id);
  sendSuccess(res, { account: serializeAccount(account) });
});

/** GET /api/bank-accounts/:id/transactions */
export const transactions = asyncHandler(async (req, res) => {
  // Confirms ownership (throws 404 if not the user's account).
  await getAccount(req.userId, req.params.id);

  const { startDate, endDate, type, page, limit, sort } = req.query;
  const result = await listTransactions(req.userId, {
    accountId: req.params.id,
    startDate,
    endDate,
    type,
    page,
    limit,
    sort,
  });

  sendSuccess(res, {
    transactions: result.rows.map(serializeTransactionRow),
    pagination: result.pagination,
  });
});

/** PATCH /api/bank-accounts/:id — safe metadata only */
export const update = asyncHandler(async (req, res) => {
  const { bankName, accountName, accountType, isActive } = req.body ?? {};
  const account = await updateAccountMetadata(req.userId, req.params.id, {
    bankName,
    accountName,
    accountType,
    isActive,
  });
  sendSuccess(res, { account: serializeAccount(account) }, { message: 'Account updated' });
});

/** DELETE /api/bank-accounts/:id — deactivate (never hard-delete) */
export const deactivate = asyncHandler(async (req, res) => {
  const account = await deactivateAccount(req.userId, req.params.id);
  sendSuccess(res, { account: serializeAccount(account) }, { message: 'Account deactivated' });
});
