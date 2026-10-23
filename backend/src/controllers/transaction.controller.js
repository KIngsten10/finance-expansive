import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { toPaise } from '../utils/money.js';
import { serializeTransactionRow } from '../utils/serialize.js';
import { listTransactions } from '../services/transactionQuery.service.js';

/** GET /api/transactions */
export const list = asyncHandler(async (req, res) => {
  const {
    startDate,
    endDate,
    type,
    accountId,
    minAmount,
    maxAmount,
    status,
    includeReversed,
    page,
    limit,
    sort,
  } = req.query;

  const result = await listTransactions(req.userId, {
    startDate,
    endDate,
    type,
    accountId,
    minAmount: minAmount != null ? toPaise(minAmount) : undefined,
    maxAmount: maxAmount != null ? toPaise(maxAmount) : undefined,
    status,
    includeReversed: includeReversed !== 'false',
    page,
    limit,
    sort,
  });

  sendSuccess(res, {
    transactions: result.rows.map(serializeTransactionRow),
    pagination: result.pagination,
  });
});
