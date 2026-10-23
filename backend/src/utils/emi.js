/**
 * EMI (Equated Monthly Installment) calculation utilities for standard
 * REDUCING-BALANCE loans. All monetary values are integer paise.
 *
 * Formula (positive interest):
 *   EMI = P * r * (1 + r)^n / ((1 + r)^n - 1)
 * where
 *   P = principal (paise)
 *   r = monthly interest rate = annualRate / 12 / 100
 *   n = number of monthly payments (tenure in months)
 *
 * Zero interest is handled separately as EMI = P / n to avoid 0/0.
 *
 * ASSUMPTIONS / LIMITATIONS (documented deliberately):
 *  - Nominal annual rate divided evenly by 12; no day-count conventions.
 *  - Monthly compounding on the reducing balance; no fees, insurance, GST,
 *    processing charges, or lender-specific rounding are modelled.
 *  - The result is an ESTIMATE. Lenders differ; always prefer a
 *    lender-provided EMI when the user has one.
 *  - Intermediate interest is computed in paise and rounded per-installment;
 *    the FINAL installment absorbs any rounding drift so the schedule closes at
 *    exactly zero outstanding (never negative).
 */

/** Validate and normalize EMI inputs. Throws Error on invalid input. */
function validateInputs(principalPaise, annualInterestRate, tenureMonths) {
  if (!Number.isInteger(principalPaise) || principalPaise <= 0) {
    throw new Error('principal must be a positive integer (paise)');
  }
  if (typeof annualInterestRate !== 'number' || annualInterestRate < 0 || !Number.isFinite(annualInterestRate)) {
    throw new Error('annualInterestRate must be a non-negative finite number');
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new Error('tenureMonths must be a positive integer');
  }
}

/**
 * Compute the estimated monthly EMI in integer paise.
 * @returns {number} EMI in paise (rounded to nearest paisa)
 */
export function calculateEmiPaise(principalPaise, annualInterestRate, tenureMonths) {
  validateInputs(principalPaise, annualInterestRate, tenureMonths);

  // Zero (or effectively zero) interest: straight-line principal division.
  if (annualInterestRate === 0) {
    return Math.round(principalPaise / tenureMonths);
  }

  const r = annualInterestRate / 12 / 100;
  const pow = Math.pow(1 + r, tenureMonths);
  const emi = (principalPaise * r * pow) / (pow - 1);
  return Math.round(emi);
}

/**
 * Summary of a loan's estimated cost.
 * @returns {{ emiPaise:number, totalPaymentPaise:number, totalInterestPaise:number }}
 */
export function estimateLoanCost(principalPaise, annualInterestRate, tenureMonths) {
  const emiPaise = calculateEmiPaise(principalPaise, annualInterestRate, tenureMonths);
  const totalPaymentPaise = emiPaise * tenureMonths;
  const totalInterestPaise = Math.max(0, totalPaymentPaise - principalPaise);
  return { emiPaise, totalPaymentPaise, totalInterestPaise };
}

/**
 * Build a full amortization schedule (integer paise). Each installment splits
 * the EMI into interest (on the opening balance) and principal. The FINAL
 * installment is adjusted so the closing balance is exactly zero.
 *
 * @param {object} args
 * @param {number} args.principalPaise
 * @param {number} args.annualInterestRate
 * @param {number} args.tenureMonths
 * @param {number} [args.emiPaise] optional lender-provided EMI to use instead
 *   of the calculated estimate
 * @param {Date} [args.firstPaymentDate] due date of installment #1
 * @returns {Array<{ installment:number, dueDate:Date|null, openingPrincipalPaise:number,
 *   scheduledPaymentPaise:number, interestPaise:number, principalPaise:number,
 *   closingPrincipalPaise:number }>}
 */
export function buildAmortizationSchedule({
  principalPaise,
  annualInterestRate,
  tenureMonths,
  emiPaise,
  firstPaymentDate,
}) {
  validateInputs(principalPaise, annualInterestRate, tenureMonths);

  const emi =
    emiPaise != null
      ? emiPaise
      : calculateEmiPaise(principalPaise, annualInterestRate, tenureMonths);
  const r = annualInterestRate === 0 ? 0 : annualInterestRate / 12 / 100;

  const schedule = [];
  let balance = principalPaise;

  for (let i = 1; i <= tenureMonths; i += 1) {
    const opening = balance;
    const interest = Math.round(opening * r);
    let scheduled = emi;
    let principalPortion = scheduled - interest;

    // Final installment (or when the remaining balance is smaller than the
    // computed principal portion) settles the remaining balance exactly.
    if (i === tenureMonths || principalPortion >= opening) {
      principalPortion = opening;
      scheduled = opening + interest;
    }

    const closing = opening - principalPortion;
    balance = closing;

    schedule.push({
      installment: i,
      dueDate: firstPaymentDate ? addMonths(firstPaymentDate, i - 1) : null,
      openingPrincipalPaise: opening,
      scheduledPaymentPaise: scheduled,
      interestPaise: interest,
      principalPaise: principalPortion,
      closingPrincipalPaise: closing,
    });

    if (balance <= 0) break;
  }

  return schedule;
}

/** Add whole months to a date (UTC-safe), clamping day overflow. */
export function addMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getUTCMonth() + months;
  const result = new Date(
    Date.UTC(d.getUTCFullYear(), targetMonth, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), 0, 0)
  );
  // Handle month overflow (e.g. Jan 31 + 1 month -> Feb 28/29).
  if (result.getUTCDate() !== d.getUTCDate()) {
    result.setUTCDate(0); // last day of previous month
  }
  return result;
}
