import mongoose from 'mongoose';

export const LOAN_STATUS = ['active', 'closed', 'defaulted'];
export const LOAN_TYPES = ['personal', 'home', 'vehicle', 'education', 'business', 'other'];
export const INTEREST_METHODS = ['reducing_balance', 'flat', 'other'];

/**
 * A loan liability owned by a user. `outstandingPrincipalPaise` is reduced only
 * by the principal component of a LoanPayment (or a documented adjustment) via
 * the transaction/loan service — never by recording an ordinary expense.
 *
 * Phase 5 adds optional metadata (loanType, interestMethod, emiPaymentDay,
 * firstPaymentDate, notes). All are optional/defaulted so pre-Phase-5 records
 * and tests remain valid.
 */
const loanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lenderName: { type: String, required: [true, 'Lender name is required'], trim: true },
    loanName: { type: String, required: [true, 'Loan name is required'], trim: true },
    loanType: {
      type: String,
      enum: { values: LOAN_TYPES, message: 'Invalid loan type' },
      default: 'other',
    },
    interestMethod: {
      type: String,
      enum: { values: INTEREST_METHODS, message: 'Invalid interest method' },
      default: 'reducing_balance',
    },
    originalPrincipalPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: 'originalPrincipalPaise must be a positive integer (paise)',
      },
    },
    outstandingPrincipalPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'outstandingPrincipalPaise must be a non-negative integer (paise)',
      },
    },
    annualInterestRate: {
      type: Number,
      required: true,
      min: [0, 'annualInterestRate cannot be negative'],
    },
    startDate: { type: Date, required: true },
    tenureMonths: { type: Number, required: true, min: [1, 'tenureMonths must be at least 1'] },
    emiAmountPaise: {
      type: Number,
      validate: {
        validator: (v) => v == null || (Number.isInteger(v) && v >= 0),
        message: 'emiAmountPaise must be a non-negative integer (paise)',
      },
    },
    // Day of month (1–31) the EMI is due, where the lender uses a fixed day.
    emiPaymentDay: {
      type: Number,
      min: [1, 'emiPaymentDay must be between 1 and 31'],
      max: [31, 'emiPaymentDay must be between 1 and 31'],
    },
    firstPaymentDate: { type: Date },
    nextPaymentDate: { type: Date },
    notes: { type: String, trim: true, maxlength: [2000, 'Notes are too long'] },
    status: {
      type: String,
      enum: { values: LOAN_STATUS, message: 'Invalid loan status' },
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

// Upcoming/overdue payment queries filter by user+status and sort by due date.
loanSchema.index({ userId: 1, status: 1, nextPaymentDate: 1 });

export const Loan = mongoose.model('Loan', loanSchema);
export default Loan;
