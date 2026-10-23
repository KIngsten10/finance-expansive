import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { toPaise, paiseToRupeesNumber } from '../utils/money.js';
import { parseAmountPaise, parseInteger } from '../utils/parseAmount.js';
import { serializeLoan, serializeLoanPayment, serializeAccount } from '../utils/serialize.js';
import { estimateLoanCost } from '../utils/emi.js';
import { getAccount } from '../services/account.service.js';
import {
  createLoan,
  listLoans,
  getLoan,
  updateLoanMetadata,
  adjustLoan,
  closeLoan,
  recordLoanPayment,
  listLoanPayments,
  getLoanPayment,
  reverseLoanPayment,
  getLoanSummary,
  getUpcomingPayments,
} from '../services/loan.service.js';
import { getLoanScheduleWithStatus } from '../services/loanSchedule.service.js';

function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey || undefined;
}

/** POST /api/loans/calculate-emi — pure calculation, no side effects. */
export const calculateEmi = asyncHandler(async (req, res) => {
  const { principal, annualInterestRate, tenureMonths } = req.body ?? {};
  if (principal == null || Number(principal) <= 0) {
    throw ApiError.badRequest('A positive principal is required');
  }
  if (annualInterestRate == null || Number(annualInterestRate) < 0) {
    throw ApiError.badRequest('A non-negative annual interest rate is required');
  }
  if (!Number.isInteger(Number(tenureMonths)) || Number(tenureMonths) < 1) {
    throw ApiError.badRequest('Tenure (months) must be a positive integer');
  }

  let result;
  try {
    result = estimateLoanCost(toPaise(principal), Number(annualInterestRate), Number(tenureMonths));
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }

  sendSuccess(res, {
    estimatedEmi: paiseToRupeesNumber(result.emiPaise),
    totalRepayment: paiseToRupeesNumber(result.totalPaymentPaise),
    totalInterest: paiseToRupeesNumber(result.totalInterestPaise),
    assumptions: [
      'Reducing-balance method with monthly compounding.',
      'Nominal annual rate divided evenly by 12.',
      'Excludes fees, insurance, GST, and lender-specific charges.',
      'Estimate only — prefer the lender-provided EMI when available.',
    ],
  });
});

/** GET /api/loans/summary */
export const summary = asyncHandler(async (req, res) => {
  const s = await getLoanSummary(req.userId);
  sendSuccess(res, {
    totalOriginalPrincipal: paiseToRupeesNumber(s.totalOriginalPrincipalPaise),
    totalOutstandingPrincipal: paiseToRupeesNumber(s.totalOutstandingPrincipalPaise),
    totalMonthlyEmi: paiseToRupeesNumber(s.totalMonthlyEmiPaise),
    activeLoanCount: s.activeLoanCount,
    upcomingPaymentCount: s.upcomingPaymentCount,
    overduePaymentCount: s.overduePaymentCount,
  });
});

/** GET /api/loans/upcoming-payments */
export const upcomingPayments = asyncHandler(async (req, res) => {
  const { startDate, endDate, page, limit } = req.query;
  const result = await getUpcomingPayments(req.userId, { startDate, endDate, page, limit });
  sendSuccess(res, {
    upcoming: result.rows.map((r) => ({
      loanId: r.loanId.toString(),
      loanName: r.loanName,
      lenderName: r.lenderName,
      dueDate: r.dueDate,
      scheduledEmi: r.scheduledEmiPaise != null ? paiseToRupeesNumber(r.scheduledEmiPaise) : null,
      estimatedPrincipal:
        r.estimatedPrincipalPaise != null ? paiseToRupeesNumber(r.estimatedPrincipalPaise) : null,
      estimatedInterest:
        r.estimatedInterestPaise != null ? paiseToRupeesNumber(r.estimatedInterestPaise) : null,
      status: r.status,
    })),
    pagination: result.pagination,
  });
});

/** GET /api/loans */
export const list = asyncHandler(async (req, res) => {
  const { search, loanType, status, page, limit, sort } = req.query;
  const result = await listLoans(req.userId, { search, loanType, status, page, limit, sort });
  sendSuccess(res, {
    loans: result.rows.map(serializeLoan),
    pagination: result.pagination,
  });
});

/** POST /api/loans */
export const create = asyncHandler(async (req, res) => {
  const {
    lenderName,
    loanName,
    loanType,
    originalPrincipal,
    annualInterestRate,
    interestMethod,
    startDate,
    tenureMonths,
    emiAmount,
    emiPaymentDay,
    firstPaymentDate,
    notes,
  } = req.body ?? {};

  const originalPrincipalPaise = parseAmountPaise(originalPrincipal, 'originalPrincipal');
  if (annualInterestRate == null || !Number.isFinite(Number(annualInterestRate)) || Number(annualInterestRate) < 0) {
    throw ApiError.badRequest('A non-negative annual interest rate is required');
  }

  const loan = await createLoan({
    userId: req.userId,
    lenderName,
    loanName,
    loanType,
    originalPrincipalPaise,
    annualInterestRate: Number(annualInterestRate),
    interestMethod,
    startDate,
    tenureMonths: parseInteger(tenureMonths, 'tenureMonths', { min: 1 }),
    emiAmountPaise: emiAmount != null && emiAmount !== '' ? parseAmountPaise(emiAmount, 'emiAmount', { allowZero: true }) : undefined,
    emiPaymentDay:
      emiPaymentDay != null && emiPaymentDay !== ''
        ? parseInteger(emiPaymentDay, 'emiPaymentDay', { min: 1, max: 31 })
        : undefined,
    firstPaymentDate,
    notes,
  });

  sendSuccess(res, { loan: serializeLoan(loan) }, { status: 201, message: 'Loan created' });
});

/** GET /api/loans/:id */
export const getOne = asyncHandler(async (req, res) => {
  const loan = await getLoan(req.userId, req.params.id);
  sendSuccess(res, { loan: serializeLoan(loan) });
});

/** PATCH /api/loans/:id — safe metadata only */
export const update = asyncHandler(async (req, res) => {
  const {
    lenderName,
    loanName,
    loanType,
    interestMethod,
    annualInterestRate,
    emiAmount,
    emiPaymentDay,
    nextPaymentDate,
    notes,
  } = req.body ?? {};

  const updates = { lenderName, loanName, loanType, interestMethod, notes };
  if (annualInterestRate !== undefined) updates.annualInterestRate = Number(annualInterestRate);
  if (emiAmount !== undefined) updates.emiAmountPaise = emiAmount != null ? toPaise(emiAmount) : null;
  if (emiPaymentDay !== undefined) updates.emiPaymentDay = Number(emiPaymentDay);
  if (nextPaymentDate !== undefined) updates.nextPaymentDate = nextPaymentDate;

  const loan = await updateLoanMetadata(req.userId, req.params.id, updates);
  sendSuccess(res, { loan: serializeLoan(loan) }, { message: 'Loan updated' });
});

/** POST /api/loans/:id/adjustment */
export const adjustment = asyncHandler(async (req, res) => {
  const { amount, direction, reason, date } = req.body ?? {};
  if (amount == null || Number(amount) <= 0) {
    throw ApiError.badRequest('A positive adjustment amount is required');
  }
  const result = await adjustLoan({
    userId: req.userId,
    loanId: req.params.id,
    amountPaise: toPaise(amount),
    direction,
    reason,
    date,
  });
  sendSuccess(res, { loan: serializeLoan(result.loan) }, { message: 'Loan adjustment recorded' });
});

/** POST /api/loans/:id/close */
export const close = asyncHandler(async (req, res) => {
  const loan = await closeLoan(req.userId, req.params.id);
  sendSuccess(res, { loan: serializeLoan(loan) }, { message: 'Loan closed' });
});

/** GET /api/loans/:id/schedule */
export const schedule = asyncHandler(async (req, res) => {
  const { loan, installments } = await getLoanScheduleWithStatus(req.userId, req.params.id);
  sendSuccess(res, {
    loanId: loan._id.toString(),
    installments: installments.map((i) => ({
      installment: i.installment,
      dueDate: i.dueDate,
      openingPrincipal: paiseToRupeesNumber(i.openingPrincipalPaise),
      scheduledPayment: paiseToRupeesNumber(i.scheduledPaymentPaise),
      estimatedInterest: paiseToRupeesNumber(i.estimatedInterestPaise),
      estimatedPrincipal: paiseToRupeesNumber(i.estimatedPrincipalPaise),
      expectedClosingPrincipal: paiseToRupeesNumber(i.expectedClosingPrincipalPaise),
      status: i.status,
    })),
  });
});

/** POST /api/loans/:id/payments */
export const createPayment = asyncHandler(async (req, res) => {
  const { accountId, paymentAmount, principalPaid, interestPaid, paymentDate, description } =
    req.body ?? {};

  if (!accountId) throw ApiError.badRequest('A payment account is required');
  const principalPaise = parseAmountPaise(principalPaid, 'principalPaid', { allowZero: true });
  const interestPaise = parseAmountPaise(interestPaid, 'interestPaid', { allowZero: true });

  // If a total was supplied, it must equal principal + interest.
  if (paymentAmount != null && paymentAmount !== '') {
    const totalPaise = parseAmountPaise(paymentAmount, 'paymentAmount', { allowZero: true });
    if (totalPaise !== principalPaise + interestPaise) {
      throw ApiError.badRequest('paymentAmount must equal principalPaid + interestPaid');
    }
  }

  // Ownership + active check (loan ownership is enforced inside the service).
  const account = await getAccount(req.userId, accountId);
  if (!account.isActive) throw ApiError.badRequest('The selected account is inactive');

  const result = await recordLoanPayment({
    userId: req.userId,
    loanId: req.params.id,
    accountId,
    principalPaidPaise: principalPaise,
    interestPaidPaise: interestPaise,
    paymentDate,
    description,
    idempotencyKey: idempotencyKey(req),
  });

  const refreshedAccount = await getAccount(req.userId, accountId);
  const loan = await getLoan(req.userId, req.params.id);

  sendSuccess(
    res,
    {
      payment: result.payment ? serializeLoanPayment(result.payment) : null,
      loan: serializeLoan(loan),
      account: serializeAccount(refreshedAccount),
      idempotentReplay: result.idempotentReplay,
    },
    { status: result.idempotentReplay ? 200 : 201, message: 'Loan payment recorded' }
  );
});

/** GET /api/loans/:id/payments */
export const listPayments = asyncHandler(async (req, res) => {
  const { startDate, endDate, page, limit, sort } = req.query;
  const result = await listLoanPayments(req.userId, req.params.id, {
    startDate,
    endDate,
    page,
    limit,
    sort,
  });
  sendSuccess(res, {
    payments: result.rows.map(serializeLoanPayment),
    pagination: result.pagination,
  });
});

/** GET /api/loans/:id/payments/:paymentId */
export const getPayment = asyncHandler(async (req, res) => {
  const payment = await getLoanPayment(req.userId, req.params.id, req.params.paymentId);
  sendSuccess(res, { payment: serializeLoanPayment(payment) });
});

/** POST /api/loans/:id/payments/:paymentId/reverse */
export const reversePayment = asyncHandler(async (req, res) => {
  const { reason } = req.body ?? {};
  const result = await reverseLoanPayment({
    userId: req.userId,
    loanId: req.params.id,
    paymentId: req.params.paymentId,
    reason,
    idempotencyKey: idempotencyKey(req),
  });

  const loan = await getLoan(req.userId, req.params.id);
  sendSuccess(res, { loan: serializeLoan(loan), idempotentReplay: result.idempotentReplay }, {
    message: 'Loan payment reversed',
  });
});
