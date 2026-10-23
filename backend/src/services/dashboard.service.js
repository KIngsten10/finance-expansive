import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { Expense } from '../models/Expense.js';
import { Transaction } from '../models/Transaction.js';
import { Loan } from '../models/Loan.js';
import { Investment } from '../models/Investment.js';
import { istDayRange, istMonthRange } from '../utils/datetime.js';

/**
 * Reusable dashboard aggregations. Every function is scoped to a single
 * authenticated user and returns integer paise (or null where a value is
 * genuinely unknown).
 *
 * How each metric treats the various record types:
 *  - Bank balance: sum of active accounts' currentBalancePaise (the ledger
 *    keeps these consistent; reversed transactions have already been undone in
 *    the balances, so no re-summation of transactions is needed or done).
 *  - Expenses (today/month): sum of Expense.amountPaise whose linked Transaction
 *    is still 'posted'. This includes the interest portion of loan payments
 *    (recorded as expenses) but NOT principal, transfers, or investment buys.
 *  - Outstanding loan principal: sum of Loan.outstandingPrincipalPaise for
 *    active loans. Principal repayment reduces this; it is never also an expense.
 *  - Investment cost basis: sum of Investment.totalInvestedPaise (what was paid).
 *  - Investment current valuation: sum of currentValuePaise ONLY for holdings
 *    that have a known value; holdings with unknown value are excluded and
 *    reported separately so unknown is never treated as zero.
 *
 * Transfers and adjustments never appear in expense/income totals; transfers
 * net to zero across a user's accounts, and adjustments are reflected directly
 * in account balances.
 */

function toObjectId(userId) {
  return new mongoose.Types.ObjectId(userId);
}

export async function getTotalBankBalancePaise(userId) {
  const [row] = await BankAccount.aggregate([
    { $match: { userId: toObjectId(userId), isActive: true } },
    { $group: { _id: null, total: { $sum: '$currentBalancePaise' } } },
  ]);
  return row?.total ?? 0;
}

/** Sum of posted-expense amounts within an IST date range. */
async function sumPostedExpenses(userId, start, end) {
  const [row] = await Expense.aggregate([
    { $match: { userId: toObjectId(userId), expenseDate: { $gte: start, $lt: end } } },
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: 'transactionId',
        foreignField: '_id',
        as: 'txn',
      },
    },
    { $unwind: '$txn' },
    { $match: { 'txn.status': 'posted' } }, // exclude reversed
    { $group: { _id: null, total: { $sum: '$amountPaise' } } },
  ]);
  return row?.total ?? 0;
}

export async function getExpensesTodayPaise(userId, ref = new Date()) {
  const { start, end } = istDayRange(ref);
  return sumPostedExpenses(userId, start, end);
}

export async function getExpensesThisMonthPaise(userId, ref = new Date()) {
  const { start, end } = istMonthRange(ref);
  return sumPostedExpenses(userId, start, end);
}

export async function getOutstandingLoanPrincipalPaise(userId) {
  const [row] = await Loan.aggregate([
    { $match: { userId: toObjectId(userId), status: 'active' } },
    { $group: { _id: null, total: { $sum: '$outstandingPrincipalPaise' } } },
  ]);
  return row?.total ?? 0;
}

export async function getInvestmentCostBasisPaise(userId) {
  const [row] = await Investment.aggregate([
    { $match: { userId: toObjectId(userId) } },
    { $group: { _id: null, total: { $sum: '$totalInvestedPaise' } } },
  ]);
  return row?.total ?? 0;
}

/**
 * Known current valuation. Returns:
 *   { knownValuationPaise, holdingsWithKnownValue, holdingsWithUnknownValue }
 * so callers can show that some holdings lack a market price rather than
 * pretending the unknowns are worth zero.
 */
export async function getInvestmentCurrentValuation(userId) {
  const [row] = await Investment.aggregate([
    { $match: { userId: toObjectId(userId) } },
    {
      $group: {
        _id: null,
        knownValuationPaise: {
          $sum: { $cond: [{ $ne: ['$currentValuePaise', null] }, '$currentValuePaise', 0] },
        },
        holdingsWithKnownValue: {
          $sum: { $cond: [{ $ne: ['$currentValuePaise', null] }, 1, 0] },
        },
        holdingsWithUnknownValue: {
          $sum: { $cond: [{ $eq: ['$currentValuePaise', null] }, 1, 0] },
        },
      },
    },
  ]);
  return {
    knownValuationPaise: row?.knownValuationPaise ?? 0,
    holdingsWithKnownValue: row?.holdingsWithKnownValue ?? 0,
    holdingsWithUnknownValue: row?.holdingsWithUnknownValue ?? 0,
  };
}

/** Active account summary (id, name, type, balance) for the dashboard. */
export async function getAccountSummary(userId) {
  const accounts = await BankAccount.find({ userId, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  return accounts.map((a) => ({
    id: a._id.toString(),
    bankName: a.bankName,
    accountName: a.accountName,
    accountType: a.accountType,
    currentBalancePaise: a.currentBalancePaise,
  }));
}

/**
 * Recent ledger transactions (default 10), with source/destination account
 * names joined in one pipeline (no N+1). Reversed entries remain visible.
 */
export async function getRecentTransactions(userId, limit = 10) {
  return Transaction.aggregate([
    { $match: { userId: toObjectId(userId) } },
    { $sort: { transactionDate: -1, _id: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'sourceAccountId',
        foreignField: '_id',
        as: 'src',
      },
    },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'destinationAccountId',
        foreignField: '_id',
        as: 'dst',
      },
    },
    {
      $project: {
        type: 1,
        amountPaise: 1,
        category: 1,
        description: 1,
        transactionDate: 1,
        status: 1,
        sourceAccountName: { $first: '$src.accountName' },
        destinationAccountName: { $first: '$dst.accountName' },
      },
    },
  ]);
}

/**
 * Expense breakdown by category for the current IST month (posted only).
 * Returns [{ category, totalPaise }] sorted by total descending.
 */
export async function getExpenseCategoryBreakdown(userId, ref = new Date()) {
  const { start, end } = istMonthRange(ref);
  return Expense.aggregate([
    { $match: { userId: toObjectId(userId), expenseDate: { $gte: start, $lt: end } } },
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: 'transactionId',
        foreignField: '_id',
        as: 'txn',
      },
    },
    { $unwind: '$txn' },
    { $match: { 'txn.status': 'posted' } },
    { $group: { _id: '$category', totalPaise: { $sum: '$amountPaise' } } },
    { $sort: { totalPaise: -1 } },
    { $project: { _id: 0, category: '$_id', totalPaise: 1 } },
  ]);
}

/**
 * Daily posted-expense totals over the last `days` IST days (inclusive of
 * today). Returns a dense series [{ date: 'YYYY-MM-DD', totalPaise }] so the
 * frontend can render a chart with zero-filled gaps.
 */
export async function getDailyExpenseTotals(userId, ref = new Date(), days = 14) {
  const today = istDayRange(ref);
  const windowStart = new Date(today.start.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const windowEnd = today.end;

  const rows = await Expense.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        expenseDate: { $gte: windowStart, $lt: windowEnd },
      },
    },
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: 'transactionId',
        foreignField: '_id',
        as: 'txn',
      },
    },
    { $unwind: '$txn' },
    { $match: { 'txn.status': 'posted' } },
    {
      $group: {
        // Bucket by IST calendar day.
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$expenseDate', timezone: 'Asia/Kolkata' },
        },
        totalPaise: { $sum: '$amountPaise' },
      },
    },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r.totalPaise]));
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayRef = new Date(ref.getTime() - i * 24 * 60 * 60 * 1000);
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dayRef);
    series.push({ date: key, totalPaise: byDay.get(key) ?? 0 });
  }
  return series;
}

/** Convenience: assemble the full dashboard summary for a user. */
export async function getDashboardSummary(userId, ref = new Date()) {
  const [
    totalBankBalancePaise,
    expensesTodayPaise,
    expensesThisMonthPaise,
    outstandingLoanPrincipalPaise,
    investmentCostBasisPaise,
    valuation,
  ] = await Promise.all([
    getTotalBankBalancePaise(userId),
    getExpensesTodayPaise(userId, ref),
    getExpensesThisMonthPaise(userId, ref),
    getOutstandingLoanPrincipalPaise(userId),
    getInvestmentCostBasisPaise(userId),
    getInvestmentCurrentValuation(userId),
  ]);

  return {
    totalBankBalancePaise,
    expensesTodayPaise,
    expensesThisMonthPaise,
    outstandingLoanPrincipalPaise,
    investmentCostBasisPaise,
    investmentValuation: valuation,
  };
}
