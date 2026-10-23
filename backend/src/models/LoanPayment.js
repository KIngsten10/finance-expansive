import mongoose from 'mongoose';

/**
 * A single repayment against a Loan. Backed by a Transaction (type
 * 'loan_payment'). Business rule enforced here and in the service:
 *   paymentAmountPaise === principalPaidPaise + interestPaidPaise
 * The principal component reduces the loan's outstanding principal; the
 * interest component is recorded as an expense by the loan service.
 */
const loanPaymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
    },
    paymentAmountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: 'paymentAmountPaise must be a positive integer (paise)',
      },
    },
    principalPaidPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'principalPaidPaise must be a non-negative integer (paise)',
      },
    },
    interestPaidPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'interestPaidPaise must be a non-negative integer (paise)',
      },
    },
    paymentDate: { type: Date, required: true },
    description: { type: String, trim: true },
    // 'posted' or 'reversed'. Reversed payments stay in history for audit.
    status: {
      type: String,
      enum: { values: ['posted', 'reversed'], message: 'Invalid loan payment status' },
      default: 'posted',
      index: true,
    },
    // Links the original payment to its reversing counterpart.
    reversedById: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment' },
    reversalOfId: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment' },
  },
  { timestamps: true }
);

loanPaymentSchema.index({ userId: 1, loanId: 1, paymentDate: -1 });

// Invariant: payment = principal + interest.
loanPaymentSchema.pre('validate', function checkSplit(next) {
  if (
    Number.isInteger(this.paymentAmountPaise) &&
    Number.isInteger(this.principalPaidPaise) &&
    Number.isInteger(this.interestPaidPaise) &&
    this.paymentAmountPaise !== this.principalPaidPaise + this.interestPaidPaise
  ) {
    return next(
      new Error('paymentAmountPaise must equal principalPaidPaise + interestPaidPaise')
    );
  }
  return next();
});

export const LoanPayment = mongoose.model('LoanPayment', loanPaymentSchema);
export default LoanPayment;
