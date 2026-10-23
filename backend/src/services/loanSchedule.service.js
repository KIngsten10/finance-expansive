import { LoanPayment } from '../models/LoanPayment.js';
import { buildAmortizationSchedule } from '../utils/emi.js';
import { getLoan } from './loan.service.js';

/**
 * Produce an ESTIMATED repayment schedule for a loan and overlay actual-payment
 * status. The schedule is computed from the stored loan terms (principal, rate,
 * tenure, lender EMI if provided). Actual posted payments are matched to
 * installments cumulatively to derive status; we never mark a future
 * installment paid just because some transaction exists.
 *
 * Statuses: 'paid', 'partially_paid', 'due', 'overdue', 'upcoming'.
 *  - An installment is covered (paid) when cumulative posted principal+interest
 *    has reached the cumulative scheduled amount up to and including it.
 *  - The first not-fully-covered installment is 'due' (if its due date is today
 *    or past) or 'overdue' (strictly past) or 'upcoming' (future).
 *  - A not-fully-covered installment that has received SOME payment toward it is
 *    'partially_paid'.
 *
 * All dates are compared using absolute instants; the stored firstPaymentDate
 * drives due dates (computed in UTC month steps). Lender-specific prepayment
 * allocation is NOT assumed — this is an estimate for tracking only.
 */
export async function getLoanScheduleWithStatus(userId, loanId, ref = new Date()) {
  const loan = await getLoan(userId, loanId);

  const schedule = buildAmortizationSchedule({
    principalPaise: loan.originalPrincipalPaise,
    annualInterestRate: loan.annualInterestRate,
    tenureMonths: loan.tenureMonths,
    emiPaise: loan.emiAmountPaise ?? undefined,
    firstPaymentDate: loan.firstPaymentDate ?? loan.startDate,
  });

  // Total posted payment amount applied so far (principal + interest).
  const posted = await LoanPayment.find({ userId, loanId, status: 'posted' }).lean();
  let appliedPaise = posted.reduce((sum, p) => sum + p.paymentAmountPaise, 0);

  let cumulativeScheduled = 0;
  const now = ref.getTime();

  const installments = schedule.map((inst) => {
    cumulativeScheduled += inst.scheduledPaymentPaise;
    const due = inst.dueDate ? inst.dueDate.getTime() : null;

    let status;
    if (appliedPaise >= cumulativeScheduled) {
      status = 'paid';
    } else if (appliedPaise > cumulativeScheduled - inst.scheduledPaymentPaise) {
      // Some money has landed on this installment but not enough to cover it.
      status = 'partially_paid';
    } else if (due == null) {
      status = 'upcoming';
    } else if (due < now) {
      status = 'overdue';
    } else {
      // Not yet due and nothing applied: upcoming (or "due" if it's today).
      status = due <= now ? 'due' : 'upcoming';
    }

    return {
      installment: inst.installment,
      dueDate: inst.dueDate,
      openingPrincipalPaise: inst.openingPrincipalPaise,
      scheduledPaymentPaise: inst.scheduledPaymentPaise,
      estimatedInterestPaise: inst.interestPaise,
      estimatedPrincipalPaise: inst.principalPaise,
      expectedClosingPrincipalPaise: inst.closingPrincipalPaise,
      status,
    };
  });

  return { loan, installments };
}
