import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { Loan, LOAN_TYPES } from '../models/Loan.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { Transaction } from '../models/Transaction.js';
import { Expense } from '../models/Expense.js';
import { ApiError } from '../utils/ApiError.js';
import { supportsTransactions, withTransaction } from '../config/database.js';
import { addMonths } from '../utils/emi.js';

/**
 * Loan payment accounting. Recording a payment atomically:
 *   1. Decreases the funding bank balance by the TOTAL payment.
 *   2. Decreases the loan's outstanding principal by the PRINCIPAL component.
 *   3. Records the INTEREST component as an expense (Transaction + Expense).
 *
 * The interest-as-expense is modelled as a separate Expense row linked to the
 * same loan_payment Transaction, so dashboards count interest as an expense
 * while principal only reduces the loan liability (never double-counted).
 */

function assertTransactionsAvailable() {
  if (!supportsTransactions()) {
    throw ApiError.badRequest(
      'Financial writes require a MongoDB replica set (multi-document transactions). ' +
      'See README: "MongoDB replica-set requirements".'
    );
  }
}

export async function recordLoanPayment({
  userId,
  loanId,
  accountId,
  principalPaidPaise,
  interestPaidPaise,
  paymentDate,
  description,
  allowPrincipalOverpay = false,
  idempotencyKey,
}) {
  assertTransactionsAvailable();

  for (const [name, v] of [
    ['principalPaidPaise', principalPaidPaise],
    ['interestPaidPaise', interestPaidPaise],
  ]) {
    if (!Number.isInteger(v) || v < 0) {
      throw ApiError.badRequest(`${name} must be a non-negative integer (paise)`);
    }
  }
  const paymentAmountPaise = principalPaidPaise + interestPaidPaise;
  if (paymentAmountPaise <= 0) {
    throw ApiError.badRequest('A loan payment must be greater than zero');
  }
  if (!mongoose.isValidObjectId(loanId)) {
    throw ApiError.badRequest('A valid loan id is required');
  }
  const date = paymentDate ? new Date(paymentDate) : new Date();

  return withTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) {
        const priorPayment = await LoanPayment.findOne({
          transactionId: prior._id,
          userId,
        }).session(session);
        return { transaction: prior, payment: priorPayment, idempotentReplay: true };
      }
    }

    const loan = await Loan.findOne({ _id: loanId, userId }).session(session);
    if (!loan) throw ApiError.notFound('Loan not found');

    // A closed loan cannot accept ordinary repayments. Principal overpay (an
    // authorized settlement path) is still allowed via allowPrincipalOverpay.
    if (loan.status === 'closed' && !allowPrincipalOverpay) {
      throw ApiError.conflict('This loan is closed and cannot accept further payments');
    }

    const account = await BankAccount.findOne({ _id: accountId, userId }).session(session);
    if (!account) throw ApiError.notFound('Bank account not found');
    if (!account.isActive) throw ApiError.badRequest('The selected account is inactive');

    // Principal cannot exceed outstanding unless an explicit adjustment is used.
    if (principalPaidPaise > loan.outstandingPrincipalPaise && !allowPrincipalOverpay) {
      throw ApiError.badRequest(
        'Principal paid exceeds outstanding principal. Use a documented adjustment to overpay.'
      );
    }

    // 1. Debit the bank by the total payment.
    const nextBalance = account.currentBalancePaise - paymentAmountPaise;
    if (nextBalance < 0 && !account.allowOverdraft) {
      throw ApiError.badRequest('Insufficient funds in the selected account');
    }
    account.currentBalancePaise = nextBalance;
    await account.save({ session });

    // 2. Reduce outstanding principal (floored at zero when overpay allowed).
    loan.outstandingPrincipalPaise = Math.max(
      0,
      loan.outstandingPrincipalPaise - principalPaidPaise
    );
    if (loan.outstandingPrincipalPaise === 0) {
      loan.status = 'closed';
      loan.nextPaymentDate = undefined;
    } else if (loan.nextPaymentDate) {
      // Advance the next payment date by one month.
      loan.nextPaymentDate = addMonths(loan.nextPaymentDate, 1);
    }
    await loan.save({ session });

    // Ledger transaction for the full payment.
    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'loan_payment',
          amountPaise: paymentAmountPaise,
          sourceAccountId: account._id,
          category: 'loan_payment',
          description: description?.trim() || `Loan payment: ${loan.loanName}`,
          transactionDate: date,
          referenceId: loan._id,
          referenceType: 'Loan',
          status: 'posted',
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );

    const [payment] = await LoanPayment.create(
      [
        {
          userId,
          loanId: loan._id,
          transactionId: txn._id,
          accountId: account._id,
          paymentAmountPaise,
          principalPaidPaise,
          interestPaidPaise,
          paymentDate: date,
          description: description?.trim(),
          status: 'posted',
        },
      ],
      { session }
    );

    // 3. Interest is an expense. Link it to the same ledger transaction.
    let interestExpense = null;
    if (interestPaidPaise > 0) {
      [interestExpense] = await Expense.create(
        [
          {
            userId,
            transactionId: txn._id,
            accountId: account._id,
            amountPaise: interestPaidPaise,
            category: 'loan_interest',
            description: `Interest on ${loan.loanName}`,
            expenseDate: date,
          },
        ],
        { session }
      );
    }

    return { transaction: txn, loan, payment, interestExpense, idempotentReplay: false };
  });
}

// ---------------------------------------------------------------------------
// Loan CRUD + lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a loan liability. Registering a loan records the debt — it does NOT
 * move any bank balance or create an expense/disbursement by itself.
 */
export async function createLoan({
  userId,
  lenderName,
  loanName,
  loanType = 'other',
  originalPrincipalPaise,
  annualInterestRate,
  interestMethod = 'reducing_balance',
  startDate,
  tenureMonths,
  emiAmountPaise,
  emiPaymentDay,
  firstPaymentDate,
  notes,
}) {
  if (!lenderName || !lenderName.trim()) throw ApiError.badRequest('Lender name is required');
  if (!loanName || !loanName.trim()) throw ApiError.badRequest('Loan name is required');
  if (loanType && !LOAN_TYPES.includes(loanType)) {
    throw ApiError.badRequest(`Loan type must be one of: ${LOAN_TYPES.join(', ')}`);
  }
  if (!Number.isInteger(originalPrincipalPaise) || originalPrincipalPaise <= 0) {
    throw ApiError.badRequest('Original principal must be a positive amount');
  }
  if (typeof annualInterestRate !== 'number' || annualInterestRate < 0) {
    throw ApiError.badRequest('Annual interest rate must be a non-negative number');
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
    throw ApiError.badRequest('Tenure (months) must be a positive integer');
  }
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) throw ApiError.badRequest('Invalid start date');

  let firstPay;
  if (firstPaymentDate) {
    firstPay = new Date(firstPaymentDate);
    if (Number.isNaN(firstPay.getTime())) throw ApiError.badRequest('Invalid first payment date');
  }
  if (emiAmountPaise != null && (!Number.isInteger(emiAmountPaise) || emiAmountPaise < 0)) {
    throw ApiError.badRequest('EMI amount must be a non-negative amount');
  }

  const loan = await Loan.create({
    userId,
    lenderName: lenderName.trim(),
    loanName: loanName.trim(),
    loanType,
    interestMethod,
    originalPrincipalPaise,
    outstandingPrincipalPaise: originalPrincipalPaise, // starts fully outstanding
    annualInterestRate,
    startDate: start,
    tenureMonths,
    emiAmountPaise: emiAmountPaise ?? undefined,
    emiPaymentDay: emiPaymentDay ?? undefined,
    firstPaymentDate: firstPay,
    nextPaymentDate: firstPay, // first due date is the next due date initially
    notes: notes?.trim(),
    status: 'active',
  });

  return loan;
}

/** List loans with filters + pagination, scoped to the user. */
export async function listLoans(userId, filters = {}) {
  const { search, loanType, status, page = 1, limit = 20, sort = 'desc' } = filters;
  const query = { userId: new mongoose.Types.ObjectId(userId) };
  if (loanType) query.loanType = loanType;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { lenderName: { $regex: search, $options: 'i' } },
      { loanName: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const sortDir = sort === 'asc' ? 1 : -1;

  const [rows, totalCount] = await Promise.all([
    Loan.find(query)
      .sort({ createdAt: sortDir })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Loan.countDocuments(query),
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

/** Load one loan owned by the user (throws 404 otherwise). */
export async function getLoan(userId, loanId) {
  if (!mongoose.isValidObjectId(loanId)) throw ApiError.badRequest('A valid loan id is required');
  const loan = await Loan.findOne({ _id: loanId, userId });
  if (!loan) throw ApiError.notFound('Loan not found');
  return loan;
}

/**
 * Update safe loan metadata only. Balance-bearing fields (outstanding
 * principal, status) and historical fields cannot be changed here.
 */
export async function updateLoanMetadata(userId, loanId, updates = {}) {
  const loan = await getLoan(userId, loanId);

  const allowed = [
    'lenderName',
    'loanName',
    'loanType',
    'interestMethod',
    'annualInterestRate',
    'emiAmountPaise',
    'emiPaymentDay',
    'nextPaymentDate',
    'notes',
  ];
  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    if (key === 'loanType' && !LOAN_TYPES.includes(updates[key])) {
      throw ApiError.badRequest(`Loan type must be one of: ${LOAN_TYPES.join(', ')}`);
    }
    if (key === 'nextPaymentDate') {
      const d = new Date(updates[key]);
      if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid next payment date');
      loan.nextPaymentDate = d;
      continue;
    }
    loan[key] = updates[key];
  }
  await loan.save();
  return loan;
}

/**
 * Authorized adjustment to the outstanding principal (e.g. a written-off
 * amount or a correction). `direction` is 'increase' or 'decrease'. Recorded in
 * the ledger as an 'adjustment' transaction for audit; never a silent rewrite.
 */
export async function adjustLoan({ userId, loanId, amountPaise, direction, reason, date }) {
  assertTransactionsAvailable();
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw ApiError.badRequest('Adjustment amount must be a positive integer (paise)');
  }
  if (!['increase', 'decrease'].includes(direction)) {
    throw ApiError.badRequest("direction must be 'increase' or 'decrease'");
  }
  if (!reason || !reason.trim()) throw ApiError.badRequest('A reason is required for an adjustment');

  const when = date ? new Date(date) : new Date();

  return withTransaction(async (session) => {
    const loan = await Loan.findOne({ _id: loanId, userId }).session(session);
    if (!loan) throw ApiError.notFound('Loan not found');

    const delta = direction === 'decrease' ? -amountPaise : amountPaise;
    const next = loan.outstandingPrincipalPaise + delta;
    if (next < 0) {
      throw ApiError.badRequest('Adjustment would make the outstanding principal negative');
    }
    loan.outstandingPrincipalPaise = next;
    if (next === 0) loan.status = 'closed';
    else if (loan.status === 'closed') loan.status = 'active';
    await loan.save({ session });

    // Audit entry (no bank movement — this adjusts the liability only).
    const [txn] = await Transaction.create(
      [
        {
          userId,
          type: 'adjustment',
          amountPaise,
          category: 'loan_adjustment',
          description: `Loan adjustment (${direction}): ${reason.trim()}`,
          transactionDate: when,
          referenceId: loan._id,
          referenceType: 'LoanAdjustment',
          status: 'posted',
          sourceAccountId: undefined,
          destinationAccountId: undefined,
          createdBy: userId,
        },
      ],
      { session }
    );

    return { loan, transaction: txn };
  });
}

/**
 * Close a loan. Only allowed when the outstanding principal is already zero. To
 * close with a remaining balance the caller must first record an audited
 * settlement adjustment (adjustLoan with direction 'decrease').
 */
export async function closeLoan(userId, loanId) {
  const loan = await getLoan(userId, loanId);
  if (loan.outstandingPrincipalPaise > 0) {
    throw ApiError.badRequest(
      'Cannot close a loan with an outstanding balance. Record a settlement adjustment first.'
    );
  }
  loan.status = 'closed';
  loan.nextPaymentDate = undefined;
  await loan.save();
  return loan;
}

// ---------------------------------------------------------------------------
// Payment queries + reversal
// ---------------------------------------------------------------------------

/** List payments for a loan with pagination + date filters. */
export async function listLoanPayments(userId, loanId, filters = {}) {
  await getLoan(userId, loanId); // ownership check

  const { startDate, endDate, page = 1, limit = 20, sort = 'desc' } = filters;
  const query = {
    userId: new mongoose.Types.ObjectId(userId),
    loanId: new mongoose.Types.ObjectId(loanId),
  };
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
  if (Object.keys(range).length) query.paymentDate = range;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const sortDir = sort === 'asc' ? 1 : -1;

  const [rows, totalCount] = await Promise.all([
    LoanPayment.find(query)
      .sort({ paymentDate: sortDir, _id: sortDir })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    LoanPayment.countDocuments(query),
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

export async function getLoanPayment(userId, loanId, paymentId) {
  await getLoan(userId, loanId);
  if (!mongoose.isValidObjectId(paymentId)) throw ApiError.badRequest('Invalid payment id');
  const payment = await LoanPayment.findOne({ _id: paymentId, userId, loanId });
  if (!payment) throw ApiError.notFound('Loan payment not found');
  return payment;
}

/**
 * Reverse a loan payment atomically: credit the bank back by the full payment,
 * restore the loan's outstanding principal by the principal component, reverse
 * the interest-expense effect, and mark records reversed. Idempotent and
 * single-use. Original records are preserved for audit.
 */
export async function reverseLoanPayment({ userId, loanId, paymentId, reason, idempotencyKey }) {
  assertTransactionsAvailable();

  return withTransaction(async (session) => {
    // Idempotent replay: a reversing transaction already created for this key.
    if (idempotencyKey) {
      const prior = await Transaction.findOne({ userId, idempotencyKey }).session(session);
      if (prior) return { idempotentReplay: true, reversalTransaction: prior };
    }

    const payment = await LoanPayment.findOne({ _id: paymentId, userId, loanId }).session(session);
    if (!payment) throw ApiError.notFound('Loan payment not found');
    if (payment.status === 'reversed' || payment.reversedById) {
      throw ApiError.conflict('This loan payment has already been reversed');
    }
    if (payment.reversalOfId) {
      throw ApiError.badRequest('A reversal payment cannot itself be reversed');
    }

    const original = await Transaction.findOne({ _id: payment.transactionId, userId }).session(
      session
    );
    if (!original) throw ApiError.notFound('Linked transaction not found');

    const loan = await Loan.findOne({ _id: loanId, userId }).session(session);
    if (!loan) throw ApiError.notFound('Loan not found');

    const account = await BankAccount.findOne({ _id: payment.accountId, userId }).session(session);
    if (!account) throw ApiError.notFound('Bank account not found');

    // 1. Credit the bank back by the full payment.
    account.currentBalancePaise += payment.paymentAmountPaise;
    await account.save({ session });

    // 2. Restore outstanding principal (reopen the loan if it had been closed).
    loan.outstandingPrincipalPaise += payment.principalPaidPaise;
    if (loan.outstandingPrincipalPaise > 0 && loan.status === 'closed') {
      loan.status = 'active';
    }
    await loan.save({ session });

    // 3. Reverse the interest expense by marking the original ledger txn
    //    reversed and creating a reversing ledger entry. The interest Expense
    //    rows are linked to the original (now-reversed) transaction, so they
    //    drop out of posted-expense totals automatically.
    original.status = 'reversed';

    const [reversalTxn] = await Transaction.create(
      [
        {
          userId,
          type: 'loan_payment',
          amountPaise: payment.paymentAmountPaise,
          sourceAccountId: original.sourceAccountId,
          category: 'loan_payment',
          description: reason?.trim() || `Reversal of loan payment ${payment._id}`,
          transactionDate: new Date(),
          referenceId: loan._id,
          referenceType: 'LoanPaymentReversal',
          status: 'posted',
          reversalOfId: original._id,
          idempotencyKey,
          createdBy: userId,
        },
      ],
      { session }
    );
    original.reversedById = reversalTxn._id;
    await original.save({ session });

    // 4. Record the reversing LoanPayment (preserves the original for audit).
    const [reversalPayment] = await LoanPayment.create(
      [
        {
          userId,
          loanId: loan._id,
          transactionId: reversalTxn._id,
          accountId: account._id,
          paymentAmountPaise: payment.paymentAmountPaise,
          principalPaidPaise: payment.principalPaidPaise,
          interestPaidPaise: payment.interestPaidPaise,
          paymentDate: new Date(),
          description: reason?.trim() || 'Reversal',
          status: 'posted',
          reversalOfId: payment._id,
        },
      ],
      { session }
    );

    payment.status = 'reversed';
    payment.reversedById = reversalPayment._id;
    await payment.save({ session });

    return { idempotentReplay: false, payment, reversalPayment, loan, reversalTransaction: reversalTxn };
  });
}

// ---------------------------------------------------------------------------
// Summary + upcoming payments
// ---------------------------------------------------------------------------

/** Aggregate loan summary for the dashboard / loans page. */
export async function getLoanSummary(userId, ref = new Date()) {
  const oid = new mongoose.Types.ObjectId(userId);
  const [agg] = await Loan.aggregate([
    { $match: { userId: oid } },
    {
      $group: {
        _id: null,
        totalOriginalPrincipalPaise: { $sum: '$originalPrincipalPaise' },
        totalOutstandingPrincipalPaise: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$outstandingPrincipalPaise', 0] },
        },
        totalMonthlyEmiPaise: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$status', 'active'] }, { $ne: ['$emiAmountPaise', null] }] },
              '$emiAmountPaise',
              0,
            ],
          },
        },
        activeLoanCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
      },
    },
  ]);

  // Upcoming vs overdue based on nextPaymentDate against "now".
  const now = ref;
  const [upcomingCount, overdueCount] = await Promise.all([
    Loan.countDocuments({ userId: oid, status: 'active', nextPaymentDate: { $gte: now } }),
    Loan.countDocuments({ userId: oid, status: 'active', nextPaymentDate: { $lt: now } }),
  ]);

  return {
    totalOriginalPrincipalPaise: agg?.totalOriginalPrincipalPaise ?? 0,
    totalOutstandingPrincipalPaise: agg?.totalOutstandingPrincipalPaise ?? 0,
    totalMonthlyEmiPaise: agg?.totalMonthlyEmiPaise ?? 0,
    activeLoanCount: agg?.activeLoanCount ?? 0,
    upcomingPaymentCount: upcomingCount,
    overduePaymentCount: overdueCount,
  };
}

/**
 * Upcoming payments across the user's active loans within a date range,
 * distinguishing overdue from upcoming. Each row derives its scheduled EMI and
 * an estimated principal/interest split for the next installment.
 */
export async function getUpcomingPayments(userId, filters = {}) {
  const { startDate, endDate, page = 1, limit = 20 } = filters;
  const oid = new mongoose.Types.ObjectId(userId);
  const query = { userId: oid, status: 'active', nextPaymentDate: { $ne: null } };

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
  if (Object.keys(range).length) query.nextPaymentDate = { ...query.nextPaymentDate, ...range };

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [loans, totalCount] = await Promise.all([
    Loan.find(query)
      .sort({ nextPaymentDate: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Loan.countDocuments(query),
  ]);

  const now = new Date();
  const rows = loans.map((loan) => {
    const r = loan.annualInterestRate / 12 / 100;
    const interest = Math.round(loan.outstandingPrincipalPaise * r);
    const scheduled = loan.emiAmountPaise ?? null;
    const principal = scheduled != null ? Math.max(0, scheduled - interest) : null;
    return {
      loanId: loan._id,
      loanName: loan.loanName,
      lenderName: loan.lenderName,
      dueDate: loan.nextPaymentDate,
      scheduledEmiPaise: scheduled,
      estimatedInterestPaise: scheduled != null ? interest : null,
      estimatedPrincipalPaise: principal,
      status: loan.nextPaymentDate && loan.nextPaymentDate < now ? 'overdue' : 'upcoming',
    };
  });

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
