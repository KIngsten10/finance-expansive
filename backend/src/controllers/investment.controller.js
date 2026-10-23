import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { paiseToRupeesNumber } from '../utils/money.js';
import { parseAmountPaise } from '../utils/parseAmount.js';
import {
  serializeInvestment,
  serializeInvestmentTxn,
  serializeAccount,
} from '../utils/serialize.js';
import { getAccount } from '../services/account.service.js';
import {
  createInvestment,
  listInvestments,
  getInvestment,
  updateInvestmentMetadata,
  recordInvestmentPurchase,
  recordInvestmentSale,
  recordInvestmentIncome,
  recordInvestmentFee,
  updateValuation,
  listInvestmentTransactions,
  reverseInvestmentTransaction,
  getPortfolioSummary,
} from '../services/investment.service.js';

function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey || undefined;
}

/** Parse an optional non-negative quantity; 400 on non-numeric input. */
function parseQuantity(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.badRequest('quantity must be a valid number');
  if (num < 0) throw ApiError.badRequest('quantity cannot be negative');
  return num;
}

/** GET /api/investments/summary */
export const summary = asyncHandler(async (req, res) => {
  const s = await getPortfolioSummary(req.userId);
  sendSuccess(res, {
    totalCostBasis: paiseToRupeesNumber(s.totalCostBasisPaise),
    knownCurrentValue: paiseToRupeesNumber(s.knownValuationPaise),
    valuationComplete: s.valuationComplete,
    holdingsWithKnownValue: s.holdingsWithKnownValue,
    holdingsWithUnknownValue: s.holdingsWithUnknownValue,
    unrealizedGain:
      s.unrealizedGainKnownPaise != null ? paiseToRupeesNumber(s.unrealizedGainKnownPaise) : null,
    realizedGain: paiseToRupeesNumber(s.realizedGainPaise),
    totalIncome: paiseToRupeesNumber(s.totalIncomePaise),
    totalFees: paiseToRupeesNumber(s.totalFeesPaise),
    investmentCount: s.investmentCount,
    allocationByType: s.allocationByType.map((a) => ({
      type: a.type,
      costBasis: paiseToRupeesNumber(a.costBasisPaise),
    })),
  });
});

/** GET /api/investments/transactions (history across investments) */
export const transactions = asyncHandler(async (req, res) => {
  const { investmentId, type, startDate, endDate, page, limit, sort } = req.query;
  const result = await listInvestmentTransactions(req.userId, {
    investmentId,
    type,
    startDate,
    endDate,
    page,
    limit,
    sort,
  });
  sendSuccess(res, {
    transactions: result.rows.map(serializeInvestmentTxn),
    pagination: result.pagination,
  });
});

/** GET /api/investments */
export const list = asyncHandler(async (req, res) => {
  const { investmentType, status, search, page, limit, sort } = req.query;
  const result = await listInvestments(req.userId, {
    investmentType,
    status,
    search,
    page,
    limit,
    sort,
  });
  sendSuccess(res, {
    investments: result.rows.map(serializeInvestment),
    pagination: result.pagination,
  });
});

/** POST /api/investments — profile only (no bank movement) */
export const create = asyncHandler(async (req, res) => {
  const { name, investmentType, providerName, identifier, notes, purchaseDate } = req.body ?? {};
  const investment = await createInvestment({
    userId: req.userId,
    name,
    investmentType,
    providerName,
    identifier,
    notes,
    purchaseDate,
  });
  sendSuccess(res, { investment: serializeInvestment(investment) }, {
    status: 201,
    message: 'Investment created',
  });
});

/** GET /api/investments/:id */
export const getOne = asyncHandler(async (req, res) => {
  const investment = await getInvestment(req.userId, req.params.id);
  sendSuccess(res, { investment: serializeInvestment(investment) });
});

/** PATCH /api/investments/:id — safe metadata only */
export const update = asyncHandler(async (req, res) => {
  const { name, investmentType, providerName, identifier, notes } = req.body ?? {};
  const investment = await updateInvestmentMetadata(req.userId, req.params.id, {
    name,
    investmentType,
    providerName,
    identifier,
    notes,
  });
  sendSuccess(res, { investment: serializeInvestment(investment) }, { message: 'Investment updated' });
});

/** Shared helper: record an investment financial op then return refreshed state. */
async function respondWithResult(req, res, result, message, createdStatus = 201) {
  const refreshedInvestment = await getInvestment(req.userId, req.params.id);
  let account = null;
  if (result.investmentTransaction?.accountId) {
    account = await getAccount(req.userId, result.investmentTransaction.accountId);
  }
  sendSuccess(
    res,
    {
      investment: serializeInvestment(refreshedInvestment),
      account: account ? serializeAccount(account) : null,
      idempotentReplay: Boolean(result.idempotentReplay),
    },
    { status: result.idempotentReplay ? 200 : createdStatus, message }
  );
}

/** POST /api/investments/:id/purchase */
export const purchase = asyncHandler(async (req, res) => {
  const { accountId, amount, fee, quantity, unitPrice, description, purchaseDate } = req.body ?? {};
  if (!accountId) throw ApiError.badRequest('A funding account is required');

  const result = await recordInvestmentPurchase({
    userId: req.userId,
    investmentId: req.params.id,
    accountId,
    amountPaise: parseAmountPaise(amount, 'amount'),
    feePaise: parseAmountPaise(fee, 'fee', { required: false, allowZero: true }) ?? 0,
    quantity: parseQuantity(quantity),
    unitPricePaise: parseAmountPaise(unitPrice, 'unitPrice', { required: false, allowZero: true }),
    description,
    transactionDate: purchaseDate,
    idempotencyKey: idempotencyKey(req),
  });
  await respondWithResult(req, res, result, 'Purchase recorded');
});

/** POST /api/investments/:id/sale */
export const sale = asyncHandler(async (req, res) => {
  const { accountId, grossProceeds, fee, quantity, description, saleDate } = req.body ?? {};
  if (!accountId) throw ApiError.badRequest('A destination account is required');

  const result = await recordInvestmentSale({
    userId: req.userId,
    investmentId: req.params.id,
    accountId,
    amountPaise: parseAmountPaise(grossProceeds, 'grossProceeds'),
    feePaise: parseAmountPaise(fee, 'fee', { required: false, allowZero: true }) ?? 0,
    quantity: parseQuantity(quantity),
    description,
    transactionDate: saleDate,
    idempotencyKey: idempotencyKey(req),
  });
  await respondWithResult(req, res, result, 'Sale recorded');
});

/** POST /api/investments/:id/income */
export const income = asyncHandler(async (req, res) => {
  const { accountId, amount, incomeType, description, incomeDate } = req.body ?? {};
  if (!accountId) throw ApiError.badRequest('A destination account is required');

  const result = await recordInvestmentIncome({
    userId: req.userId,
    investmentId: req.params.id,
    accountId,
    amountPaise: parseAmountPaise(amount, 'amount'),
    incomeType,
    description,
    transactionDate: incomeDate,
    idempotencyKey: idempotencyKey(req),
  });
  await respondWithResult(req, res, result, 'Income recorded');
});

/** POST /api/investments/:id/fee */
export const fee = asyncHandler(async (req, res) => {
  const { accountId, amount, description, feeDate } = req.body ?? {};
  if (!accountId) throw ApiError.badRequest('A funding account is required');

  const result = await recordInvestmentFee({
    userId: req.userId,
    investmentId: req.params.id,
    accountId,
    amountPaise: parseAmountPaise(amount, 'amount'),
    description,
    transactionDate: feeDate,
    idempotencyKey: idempotencyKey(req),
  });
  await respondWithResult(req, res, result, 'Fee recorded');
});

/** POST /api/investments/:id/valuation */
export const valuation = asyncHandler(async (req, res) => {
  const { currentValue, valuationDate, source } = req.body ?? {};
  const valuePaise = parseAmountPaise(currentValue, 'currentValue', { allowZero: true });
  const investment = await updateValuation({
    userId: req.userId,
    investmentId: req.params.id,
    valuePaise,
    valuationDate,
    source,
  });
  sendSuccess(res, { investment: serializeInvestment(investment) }, { message: 'Valuation updated' });
});

/** POST /api/investments/transactions/:txnId/reverse */
export const reverse = asyncHandler(async (req, res) => {
  const { reason } = req.body ?? {};
  const result = await reverseInvestmentTransaction({
    userId: req.userId,
    investmentTxnId: req.params.txnId,
    reason,
    idempotencyKey: idempotencyKey(req),
  });
  sendSuccess(res, { idempotentReplay: Boolean(result.idempotentReplay) }, {
    message: 'Investment transaction reversed',
  });
});
