import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { Investment, INVESTMENT_TYPES } from '../models/Investment.js';
import { InvestmentTransaction } from '../models/InvestmentTransaction.js';
import { Transaction } from '../models/Transaction.js';
import { Expense } from '../models/Expense.js';
import { ApiError } from '../utils/ApiError.js';
import { supportsTransactions, withTransaction } from '../config/database.js';

/**
 * Investment accounting. All balance changes go through atomic MongoDB
 * transactions (replica set required).
 *
 * ACCOUNTING RULES (documented):
 *  - PURCHASE: total cash out = amount + fee. The bank is debited by the total
 *    and the WHOLE total (amount + fee) is added to cost basis. A purchase is a
 *    transfer of value from cash to an asset — NEVER an ordinary expense.
 *  - SALE: net proceeds = gross - fee. The bank is credited with the NET. Cost
 *    basis removed uses weighted-average cost (for unitized assets) or the full
 *    remaining basis (non-unitized full liquidation). Realized gain =
 *    netProceeds - costBasisRemoved. Sale proceeds are NOT ordinary income.
 *  - INCOME (dividend/interest): credited to a bank account when paid out. It
 *    increases totalIncomePaise but does NOT change cost basis or market value.
 *  - FEE (standalone): debits the bank and IS recorded as an ordinary expense
 *    (category 'investment_fee'). Purchase/sale fees are handled inline (above)
 *    and are NOT also recorded as standalone expenses (no double counting).
 *  - VALUATION: manual only; changes currentValuePaise + history. No cash
 *    movement, no cost-basis change. Unknown valuation stays null (never zero).
 */

function assertTransactionsAvailable() {
  if (!supportsTransactions()) {
    throw ApiError.badRequest(
      'Financial writes require a MongoDB replica set (multi-document transactions). ' +
      'See README: "MongoDB replica-set requirements".'
    );
  }
}

function assertPositiveIntegerPaise(v, field) {
  if (!Number.isInteger(v) || v <= 0) {
    throw ApiError.badRequest(`${field} must be a positive integer (paise)`);
  }
}
function assertNonNegativeIntegerPaise(v, field) {
  if (!Number.isInteger(v) || v < 0) {
    throw ApiError.badRequest(`${field} must be a non-negative integer (paise)`);
  }
}

async function loadOwnedInvestment(investmentId, userId, session) {
  if (!mongoose.isValidObjectId(investmentId)) {
    throw ApiError.badRequest('A valid investment id is required');
  }
  const investment = await Investment.findOne({ _id: investmentId, userId }).session(session);
  if (!investment) throw ApiError.notFound('Investment not found');
  return investment;
}

async function loadOwnedActiveAccount(accountId, userId, session, { requireActive = true } = {}) {
  if (!mongoose.isValidObjectId(accountId)) {
    throw ApiError.badRequest('A valid account id is required');
  }
  const account = await BankAccount.findOne({ _id: accountId, userId }).session(session);
  if (!account) throw ApiError.notFound('Bank account not found');
  if (requireActive && !account.isActive) throw ApiError.badRequest('The selected account is inactive');
  return account;
}

// ---------------------------------------------------------------------------
// Investment profile CRUD
// ---------------------------------------------------------------------------

/**
 * Create an investment PROFILE only. This never debits a bank account or
 * creates a purchase — the actual purchase is a separate operation.
 */
export async function createInvestment({
  userId,
  name,
  investmentType,
  providerName,
  identifier,
  notes,
  purchaseDate,
}) {
  if (!name || !name.trim()) throw ApiError.badRequest('Investment name is required');
  if (!INVESTMENT_TYPES.includes(investmentType)) {
    throw ApiError.badRequest(`Investment type must be one of: ${INVESTMENT_TYPES.join(', ')}`);
  }
  const investment = await Investment.create({
    userId,
    name: name.trim(),
    investmentType,
    providerName: providerName?.trim(),
    identifier: identifier?.trim(),
    notes: notes?.trim(),
    purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
    totalInvestedPaise: 0,
    status: 'open',
  });
  return investment;
}

export async function listInvestments(userId, filters = {}) {
  const { investmentType, status, search, page = 1, limit = 50, sort = 'desc' } = filters;
  const query = { userId: new mongoose.Types.ObjectId(userId) };
  if (investmentType) query.investmentType = investmentType;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { providerName: { $regex: search, $options: 'i' } },
    ];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const sortDir = sort === 'asc' ? 1 : -1;

  const [rows, totalCount] = await Promise.all([
    Investment.find(query)
      .sort({ createdAt: sortDir })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Investment.countDocuments(query),
  ]);
  return {
    rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
    },
  };
}

export async function getInvestment(userId, investmentId) {
  if (!mongoose.isValidObjectId(investmentId)) throw ApiError.badRequest('Invalid investment id');
  const investment = await Investment.findOne({ _id: investmentId, userId });
  if (!investment) throw ApiError.notFound('Investment not found');
  return investment;
}

/** Update safe metadata only (never cost basis, holdings, or valuation). */
export async function updateInvestmentMetadata(userId, investmentId, updates = {}) {
  const investment = await getInvestment(userId, investmentId);
  const allowed = ['name', 'investmentType', 'providerName', 'identifier', 'notes'];
  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    if (key === 'investmentType' && !INVESTMENT_TYPES.includes(updates[key])) {
      throw ApiError.badRequest(`Investment type must be one of: ${INVESTMENT_TYPES.join(', ')}`);
    }
    if (key === 'name' && !String(updates[key]).trim()) {
      throw ApiError.badRequest('Investment name cannot be empty');
    }
    investment[key] = typeof updates[key] === 'string' ? updates[key].trim() : updates[key];
  }
  await investment.save();
  return investment;
}

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

export async function recordInvestmentPurchase({
  userId,
  investmentId,
  accountId,
  amountPaise,
  feePaise = 0,
  quantity = null,
  unitPricePaise = null,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise, 'amount');
  assertNonNegativeIntegerPaise(feePaise, 'fee');
  if (quantity != null && quantity < 0) throw ApiError.badRequest('Quantity cannot be negative');
  const date = transactionDate ? new Date(transactionDate) : new Date();
  const totalPaise = amountPaise + feePaise; // cash out and cost basis added

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) {
        const invTxn = await InvestmentTransaction.findOne({
          transactionId: prior._id,
          userId,
        }).session(session);
        return { transaction: prior, investmentTransaction: invTxn, idempotentReplay: true };
      }
    }

    const investment = await loadOwnedInvestment(investmentId, userId, session);
    const account = await loadOwnedActiveAccount(accountId, userId, session);

    const next = account.currentBalancePaise - totalPaise;
    if (next < 0 && !account.allowOverdraft) {
      throw ApiError.badRequest('Insufficient funds in the selected account');
    }
    account.currentBalancePaise = next;
    await account.save({ session });

    // Cost basis includes the fee (acquisition cost).
    investment.totalInvestedPaise += totalPaise;
    investment.totalFeesPaise += feePaise;
    if (quantity != null) {
      const prevQty = investment.quantity || 0;
      investment.quantity = prevQty + quantity;
      investment.averageCostPaise =
        investment.quantity > 0
          ? Math.round(investment.totalInvestedPaise / investment.quantity)
          : null;
    }
    if (!investment.purchaseDate) investment.purchaseDate = date;
    investment.status = 'open';
    await investment.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'investment_purchase',
          amountPaise: totalPaise,
          sourceAccountId: account._id,
          category: 'investment',
          description: description?.trim() || `Purchase: ${investment.name}`,
          transactionDate: date,
          referenceId: investment._id,
          referenceType: 'Investment',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    const [invTxn] = await InvestmentTransaction.create(
      [
        {
          userId,
          investmentId: investment._id,
          transactionId: txn._id,
          accountId: account._id,
          type: 'purchase',
          amountPaise: totalPaise,
          feePaise,
          unitPricePaise,
          quantity,
          description: description?.trim(),
          transactionDate: date,
          status: 'posted',
        },
      ],
      { session }
    );

    return { transaction: txn, investment, investmentTransaction: invTxn, idempotentReplay: false };
  });
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------

export async function recordInvestmentSale({
  userId,
  investmentId,
  accountId,
  amountPaise, // GROSS proceeds
  feePaise = 0,
  quantity = null,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise, 'grossProceeds');
  assertNonNegativeIntegerPaise(feePaise, 'fee');
  if (feePaise >= amountPaise) throw ApiError.badRequest('Fee cannot exceed gross proceeds');
  const date = transactionDate ? new Date(transactionDate) : new Date();
  const netProceedsPaise = amountPaise - feePaise;

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) {
        const invTxn = await InvestmentTransaction.findOne({
          transactionId: prior._id,
          userId,
        }).session(session);
        return { transaction: prior, investmentTransaction: invTxn, idempotentReplay: true };
      }
    }

    const investment = await loadOwnedInvestment(investmentId, userId, session);
    const account = await loadOwnedActiveAccount(accountId, userId, session);

    // Cost basis removed (weighted-average cost).
    let costBasisRemoved;
    let realizedGainKnown = true;
    if (quantity != null) {
      if (investment.quantity == null || quantity > investment.quantity) {
        throw ApiError.badRequest('Cannot sell more quantity than is held');
      }
      const avg = investment.averageCostPaise;
      if (avg == null) {
        // Unknown unit cost -> cannot fabricate a realized gain.
        costBasisRemoved = 0;
        realizedGainKnown = false;
      } else {
        costBasisRemoved = Math.round(avg * quantity);
      }
      investment.quantity -= quantity;
    } else {
      // Non-unitized full liquidation of remaining basis.
      costBasisRemoved = investment.totalInvestedPaise;
    }

    investment.totalInvestedPaise = Math.max(0, investment.totalInvestedPaise - costBasisRemoved);
    investment.totalFeesPaise += feePaise;
    if ((investment.quantity == null && costBasisRemoved > 0) || investment.quantity === 0) {
      investment.status = 'closed';
    }

    const realizedGainPaise = realizedGainKnown ? netProceedsPaise - costBasisRemoved : null;
    if (realizedGainPaise != null) {
      investment.realizedGainPaise = (investment.realizedGainPaise || 0) + realizedGainPaise;
    }
    await investment.save({ session });

    // Credit NET proceeds to the bank.
    account.currentBalancePaise += netProceedsPaise;
    await account.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'investment_sale',
          amountPaise: netProceedsPaise,
          destinationAccountId: account._id,
          category: 'investment',
          description: description?.trim() || `Sale: ${investment.name}`,
          transactionDate: date,
          referenceId: investment._id,
          referenceType: 'Investment',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    const [invTxn] = await InvestmentTransaction.create(
      [
        {
          userId,
          investmentId: investment._id,
          transactionId: txn._id,
          accountId: account._id,
          type: 'sale',
          amountPaise: netProceedsPaise,
          feePaise,
          quantity,
          realizedGainPaise,
          description: description?.trim(),
          transactionDate: date,
          status: 'posted',
        },
      ],
      { session }
    );

    return {
      transaction: txn,
      investment,
      investmentTransaction: invTxn,
      realizedGainPaise,
      netProceedsPaise,
      idempotentReplay: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Income (dividend / interest)
// ---------------------------------------------------------------------------

export async function recordInvestmentIncome({
  userId,
  investmentId,
  accountId,
  amountPaise,
  incomeType = 'dividend', // 'dividend' | 'interest'
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise, 'amount');
  if (!['dividend', 'interest'].includes(incomeType)) {
    throw ApiError.badRequest("incomeType must be 'dividend' or 'interest'");
  }
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) {
        const invTxn = await InvestmentTransaction.findOne({
          transactionId: prior._id,
          userId,
        }).session(session);
        return { transaction: prior, investmentTransaction: invTxn, idempotentReplay: true };
      }
    }

    const investment = await loadOwnedInvestment(investmentId, userId, session);
    // Income here is PAID OUT to a bank account (we only support payout income).
    const account = await loadOwnedActiveAccount(accountId, userId, session);

    account.currentBalancePaise += amountPaise;
    await account.save({ session });

    investment.totalIncomePaise = (investment.totalIncomePaise || 0) + amountPaise;
    // Income does NOT change cost basis or market value.
    await investment.save({ session });

    const [txn] = await Transaction.create(
      [
        {
          userId,
          // Ledger-wise this is money into a bank (income), but we categorize it
          // as investment income so it is not confused with salary etc.
          type: 'income',
          amountPaise,
          destinationAccountId: account._id,
          category: `investment_${incomeType}`,
          description: description?.trim() || `${incomeType} from ${investment.name}`,
          transactionDate: date,
          referenceId: investment._id,
          referenceType: 'Investment',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    const [invTxn] = await InvestmentTransaction.create(
      [
        {
          userId,
          investmentId: investment._id,
          transactionId: txn._id,
          accountId: account._id,
          type: incomeType,
          amountPaise,
          description: description?.trim(),
          transactionDate: date,
          status: 'posted',
        },
      ],
      { session }
    );

    return { transaction: txn, investment, investmentTransaction: invTxn, idempotentReplay: false };
  });
}

// ---------------------------------------------------------------------------
// Standalone fee (debits bank, recorded as an ordinary expense)
// ---------------------------------------------------------------------------

export async function recordInvestmentFee({
  userId,
  investmentId,
  accountId,
  amountPaise,
  description,
  transactionDate,
  idempotencyKey,
}) {
  assertTransactionsAvailable();
  assertPositiveIntegerPaise(amountPaise, 'amount');
  const date = transactionDate ? new Date(transactionDate) : new Date();

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) {
        const invTxn = await InvestmentTransaction.findOne({
          transactionId: prior._id,
          userId,
        }).session(session);
        return { transaction: prior, investmentTransaction: invTxn, idempotentReplay: true };
      }
    }

    const investment = await loadOwnedInvestment(investmentId, userId, session);
    const account = await loadOwnedActiveAccount(accountId, userId, session);

    const next = account.currentBalancePaise - amountPaise;
    if (next < 0 && !account.allowOverdraft) {
      throw ApiError.badRequest('Insufficient funds in the selected account');
    }
    account.currentBalancePaise = next;
    await account.save({ session });

    investment.totalFeesPaise = (investment.totalFeesPaise || 0) + amountPaise;
    await investment.save({ session });

    // A standalone fee IS an ordinary expense (unlike purchase/sale fees).
    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'expense',
          amountPaise,
          sourceAccountId: account._id,
          category: 'investment_fee',
          description: description?.trim() || `Fee: ${investment.name}`,
          transactionDate: date,
          referenceId: investment._id,
          referenceType: 'Investment',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    // Link an Expense row so it appears in expense reporting (like loan interest).
    const [expense] = await Expense.create(
      [
        {
          userId,
          transactionId: txn._id,
          accountId: account._id,
          amountPaise,
          category: 'investment_fee',
          description: description?.trim() || `Fee: ${investment.name}`,
          expenseDate: date,
        },
      ],
      { session }
    );
    txn.referenceId = expense._id;
    txn.referenceType = 'Expense';
    await txn.save({ session });

    const [invTxn] = await InvestmentTransaction.create(
      [
        {
          userId,
          investmentId: investment._id,
          transactionId: txn._id,
          accountId: account._id,
          type: 'fee',
          amountPaise,
          description: description?.trim(),
          transactionDate: date,
          status: 'posted',
        },
      ],
      { session }
    );

    return { transaction: txn, investment, investmentTransaction: invTxn, expense, idempotentReplay: false };
  });
}

// ---------------------------------------------------------------------------
// Valuation (manual only; no cash movement, no cost-basis change)
// ---------------------------------------------------------------------------

export async function updateValuation({ userId, investmentId, valuePaise, valuationDate, source }) {
  assertNonNegativeIntegerPaise(valuePaise, 'currentValue');
  const investment = await getInvestment(userId, investmentId);
  const when = valuationDate ? new Date(valuationDate) : new Date();
  if (Number.isNaN(when.getTime())) throw ApiError.badRequest('Invalid valuation date');

  investment.currentValuePaise = valuePaise;
  investment.valuationDate = when;
  investment.valuationSource = source?.trim() || null;
  investment.valuationIsManual = true;
  investment.valuationHistory.push({
    valuePaise,
    valuationDate: when,
    source: source?.trim(),
    isManual: true,
  });
  await investment.save();
  return investment;
}

// ---------------------------------------------------------------------------
// Transaction history + reversal
// ---------------------------------------------------------------------------

export async function listInvestmentTransactions(userId, filters = {}) {
  const {
    investmentId,
    type,
    startDate,
    endDate,
    page = 1,
    limit = 20,
    sort = 'desc',
  } = filters;
  const query = { userId: new mongoose.Types.ObjectId(userId) };
  if (investmentId) {
    if (!mongoose.isValidObjectId(investmentId)) throw ApiError.badRequest('Invalid investmentId');
    query.investmentId = new mongoose.Types.ObjectId(investmentId);
  }
  if (type) query.type = type;
  const range = {};
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid startDate');
    range.$gte = d;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid endDate');
    range.$lte = d;
  }
  if (Object.keys(range).length) query.transactionDate = range;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const sortDir = sort === 'asc' ? 1 : -1;

  // Join investment name + account name in one pipeline (no N+1).
  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: Investment.collection.name,
        localField: 'investmentId',
        foreignField: '_id',
        as: 'inv',
      },
    },
    { $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        as: 'acct',
      },
    },
    { $unwind: { path: '$acct', preserveNullAndEmptyArrays: true } },
  ];

  const [rows, countRow] = await Promise.all([
    InvestmentTransaction.aggregate([
      ...pipeline,
      { $sort: { transactionDate: sortDir, _id: sortDir } },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
      {
        $project: {
          type: 1,
          amountPaise: 1,
          feePaise: 1,
          quantity: 1,
          unitPricePaise: 1,
          realizedGainPaise: 1,
          description: 1,
          transactionDate: 1,
          status: 1,
          investmentId: 1,
          accountId: 1,
          reversalOfId: 1,
          investmentName: '$inv.name',
          accountName: '$acct.accountName',
        },
      },
    ]),
    InvestmentTransaction.aggregate([...pipeline, { $count: 'count' }]),
  ]);

  const totalCount = countRow[0]?.count ?? 0;
  return {
    rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
    },
  };
}

/**
 * Reverse an investment transaction (purchase/sale/dividend/interest/fee)
 * atomically, undoing its bank, holdings, cost-basis, income, fee, and
 * realized-gain effects, and reversing any linked ordinary expense (fees).
 * Single-use and idempotent; originals are preserved.
 */
export async function reverseInvestmentTransaction({ userId, investmentTxnId, reason, idempotencyKey }) {
  assertTransactionsAvailable();

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) return { idempotentReplay: true, reversalTransaction: prior };
    }

    if (!mongoose.isValidObjectId(investmentTxnId)) {
      throw ApiError.badRequest('A valid investment transaction id is required');
    }
    const invTxn = await InvestmentTransaction.findOne({ _id: investmentTxnId, userId }).session(
      session
    );
    if (!invTxn) throw ApiError.notFound('Investment transaction not found');
    if (invTxn.status === 'reversed' || invTxn.reversedById) {
      throw ApiError.conflict('This investment transaction has already been reversed');
    }
    if (invTxn.reversalOfId) {
      throw ApiError.badRequest('A reversal cannot itself be reversed');
    }

    /*
     * COST-BASIS DEPENDENCY GUARD (Phase 7, Part 3).
     *
     * Purchases and sales mutate the weighted-average cost basis. A later
     * purchase/sale is computed FROM that basis, so naively inverting an older
     * purchase/sale would leave quantity, averageCostPaise, totalInvestedPaise,
     * and realizedGainPaise mutually inconsistent.
     *
     * Policy: a 'purchase' or 'sale' may only be reversed when it is the MOST
     * RECENT posted cost-basis-affecting activity for that investment (i.e. no
     * posted purchase/sale exists after it). Otherwise we reject and require the
     * user to reverse later activity first, or record a compensating
     * transaction. Income/fee reversals do not touch cost basis and are exempt.
     */
    if (invTxn.type === 'purchase' || invTxn.type === 'sale') {
      const laterDependent = await InvestmentTransaction.findOne({
        userId,
        investmentId: invTxn.investmentId,
        type: { $in: ['purchase', 'sale'] },
        status: 'posted',
        reversalOfId: null,
        _id: { $ne: invTxn._id },
        $or: [
          { transactionDate: { $gt: invTxn.transactionDate } },
          { transactionDate: invTxn.transactionDate, _id: { $gt: invTxn._id } },
        ],
      }).session(session);

      if (laterDependent) {
        throw ApiError.conflict(
          'This purchase/sale cannot be reversed because a later purchase or sale depends on ' +
          'its cost basis. Reverse the later activity first, or record a compensating ' +
          'transaction instead.'
        );
      }
    }

    const original = await Transaction.findOne({ _id: invTxn.transactionId, userId }).session(
      session
    );
    if (!original) throw ApiError.notFound('Linked transaction not found');

    const investment = await loadOwnedInvestment(invTxn.investmentId, userId, session);
    const account = invTxn.accountId
      ? await BankAccount.findOne({ _id: invTxn.accountId, userId }).session(session)
      : null;

    // Undo effects per type.
    switch (invTxn.type) {
      case 'purchase': {
        if (account) {
          account.currentBalancePaise += invTxn.amountPaise; // refund cash out
          await account.save({ session });
        }
        investment.totalInvestedPaise = Math.max(0, investment.totalInvestedPaise - invTxn.amountPaise);
        investment.totalFeesPaise = Math.max(0, (investment.totalFeesPaise || 0) - (invTxn.feePaise || 0));
        if (invTxn.quantity != null && investment.quantity != null) {
          investment.quantity = Math.max(0, investment.quantity - invTxn.quantity);
          investment.averageCostPaise =
            investment.quantity > 0
              ? Math.round(investment.totalInvestedPaise / investment.quantity)
              : null;
        }
        break;
      }
      case 'sale': {
        if (account) {
          account.currentBalancePaise -= invTxn.amountPaise; // claw back net proceeds
          await account.save({ session });
        }
        // Restore quantity and realized gain.
        if (invTxn.quantity != null) {
          investment.quantity = (investment.quantity || 0) + invTxn.quantity;
        }
        if (invTxn.realizedGainPaise != null) {
          const costBasisRemoved = invTxn.amountPaise - invTxn.realizedGainPaise;
          investment.totalInvestedPaise += costBasisRemoved;
          investment.realizedGainPaise =
            (investment.realizedGainPaise || 0) - invTxn.realizedGainPaise;
          investment.averageCostPaise =
            investment.quantity > 0
              ? Math.round(investment.totalInvestedPaise / investment.quantity)
              : investment.averageCostPaise;
        }
        investment.totalFeesPaise = Math.max(0, (investment.totalFeesPaise || 0) - (invTxn.feePaise || 0));
        if (investment.quantity > 0 || investment.totalInvestedPaise > 0) investment.status = 'open';
        break;
      }
      case 'dividend':
      case 'interest': {
        if (account) {
          account.currentBalancePaise -= invTxn.amountPaise; // claw back income
          await account.save({ session });
        }
        investment.totalIncomePaise = Math.max(0, (investment.totalIncomePaise || 0) - invTxn.amountPaise);
        break;
      }
      case 'fee': {
        if (account) {
          account.currentBalancePaise += invTxn.amountPaise; // refund fee
          await account.save({ session });
        }
        investment.totalFeesPaise = Math.max(0, (investment.totalFeesPaise || 0) - invTxn.amountPaise);
        break;
      }
      default:
        break;
    }
    await investment.save({ session });

    // Mark the original ledger transaction reversed (drops linked expenses from
    // posted-expense totals automatically) and create a reversing ledger entry.
    original.status = 'reversed';
    const [reversalTxn] = await Transaction.create(
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
          referenceType: 'InvestmentReversal',
          reversalOfId: original._id,
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );
    original.reversedById = reversalTxn._id;
    await original.save({ session });

    // Create the reversing InvestmentTransaction and mark the original reversed.
    const [reversalInvTxn] = await InvestmentTransaction.create(
      [
        {
          userId,
          investmentId: investment._id,
          transactionId: reversalTxn._id,
          accountId: invTxn.accountId,
          type: invTxn.type,
          amountPaise: invTxn.amountPaise,
          feePaise: invTxn.feePaise,
          quantity: invTxn.quantity,
          description: reason?.trim() || 'Reversal',
          transactionDate: new Date(),
          status: 'posted',
          reversalOfId: invTxn._id,
        },
      ],
      { session }
    );
    invTxn.status = 'reversed';
    invTxn.reversedById = reversalInvTxn._id;
    await invTxn.save({ session });

    return { idempotentReplay: false, investment, reversalTransaction: reversalTxn };
  });
}

// ---------------------------------------------------------------------------
// Portfolio summary
// ---------------------------------------------------------------------------

export async function getPortfolioSummary(userId) {
  const oid = new mongoose.Types.ObjectId(userId);
  const investments = await Investment.find({ userId: oid }).lean();

  let totalCostBasisPaise = 0;
  let knownValuationPaise = 0;
  let unrealizedGainKnownPaise = 0; // only over holdings with known valuation
  let realizedGainPaise = 0;
  let totalIncomePaise = 0;
  let totalFeesPaise = 0;
  let holdingsWithKnownValue = 0;
  let holdingsWithUnknownValue = 0;

  const allocationMap = new Map();

  for (const inv of investments) {
    totalCostBasisPaise += inv.totalInvestedPaise || 0;
    realizedGainPaise += inv.realizedGainPaise || 0;
    totalIncomePaise += inv.totalIncomePaise || 0;
    totalFeesPaise += inv.totalFeesPaise || 0;

    const alloc = allocationMap.get(inv.investmentType) || 0;
    allocationMap.set(inv.investmentType, alloc + (inv.totalInvestedPaise || 0));

    if (inv.currentValuePaise != null) {
      holdingsWithKnownValue += 1;
      knownValuationPaise += inv.currentValuePaise;
      // Unrealized gain only over the portion with a known valuation.
      unrealizedGainKnownPaise += inv.currentValuePaise - (inv.totalInvestedPaise || 0);
    } else {
      holdingsWithUnknownValue += 1;
    }
  }

  const valuationComplete = holdingsWithUnknownValue === 0;

  return {
    totalCostBasisPaise,
    knownValuationPaise,
    valuationComplete,
    holdingsWithKnownValue,
    holdingsWithUnknownValue,
    // Unrealized gain is only meaningful over known-valuation holdings.
    unrealizedGainKnownPaise: holdingsWithKnownValue > 0 ? unrealizedGainKnownPaise : null,
    realizedGainPaise,
    totalIncomePaise,
    totalFeesPaise,
    investmentCount: investments.length,
    allocationByType: Array.from(allocationMap.entries()).map(([type, costBasisPaise]) => ({
      type,
      costBasisPaise,
    })),
  };
}
