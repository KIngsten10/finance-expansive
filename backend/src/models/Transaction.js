import mongoose from 'mongoose';

export const TRANSACTION_TYPES = [
  'expense',
  'income',
  'transfer',
  'loan_payment',
  'investment_purchase',
  'investment_sale',
  'adjustment',
];

export const TRANSACTION_STATUS = ['posted', 'reversed'];

/**
 * The central ledger entry. Every balance change in the system is backed by a
 * Transaction. Amounts are POSITIVE integer paise; the `type` plus source/
 * destination accounts define the direction of money movement.
 *
 * Account-field requirements by type (enforced in a pre-validate hook):
 *   expense              -> sourceAccountId (money leaves an account)
 *   income               -> destinationAccountId (money enters an account)
 *   loan_payment         -> sourceAccountId
 *   investment_purchase  -> sourceAccountId
 *   investment_sale      -> destinationAccountId
 *   transfer             -> both source and destination (must differ)
 *   adjustment           -> sourceAccountId (the account being corrected)
 *
 * Posted transactions are never physically deleted; corrections happen via a
 * paired reversal transaction (status 'reversed' + a new reversing entry).
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: { values: TRANSACTION_TYPES, message: 'Invalid transaction type' },
      required: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: 'amountPaise must be a positive integer (paise)',
      },
    },
    currency: { type: String, default: 'INR', uppercase: true, trim: true },
    sourceAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    destinationAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    category: { type: String, trim: true },
    description: { type: String, trim: true },
    transactionDate: { type: Date, required: true },
    // Links to a domain record (Expense, LoanPayment, InvestmentTransaction, or
    // the original transaction when this entry is a reversal).
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    referenceType: { type: String, trim: true },
    status: {
      type: String,
      enum: { values: TRANSACTION_STATUS, message: 'Invalid status' },
      default: 'posted',
      index: true,
    },
    // Set on the original transaction once it has been reversed, pointing at the
    // reversing entry (and vice versa). Prevents double reversal.
    reversalOfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    reversedById: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    idempotencyKey: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Per-type account-field validation.
transactionSchema.pre('validate', function validateAccounts(next) {
  const needsSource = ['expense', 'loan_payment', 'investment_purchase', 'adjustment', 'transfer'];
  const needsDestination = ['income', 'investment_sale', 'transfer'];

  // A loan-liability adjustment (referenceType 'LoanAdjustment') changes only
  // the loan's outstanding principal and moves no bank money, so it is exempt
  // from the bank-account requirement.
  const isLoanLiabilityAdjustment =
    this.type === 'adjustment' && this.referenceType === 'LoanAdjustment';

  if (needsSource.includes(this.type) && !this.sourceAccountId && !isLoanLiabilityAdjustment) {
    return next(new Error(`Transaction type "${this.type}" requires a source account`));
  }
  if (needsDestination.includes(this.type) && !this.destinationAccountId) {
    return next(new Error(`Transaction type "${this.type}" requires a destination account`));
  }
  if (
    this.type === 'transfer' &&
    this.sourceAccountId &&
    this.destinationAccountId &&
    this.sourceAccountId.equals(this.destinationAccountId)
  ) {
    return next(new Error('Transfer source and destination accounts must differ'));
  }
  return next();
});

/**
 * Idempotency: a given (userId, idempotencyKey) may post at most one
 * transaction. Partial index so documents without a key are unconstrained.
 */
transactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

// Common query path: a user's ledger ordered by date.
transactionSchema.index({ userId: 1, transactionDate: -1 });

transactionSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    type: this.type,
    amountPaise: this.amountPaise,
    currency: this.currency,
    sourceAccountId: this.sourceAccountId?.toString(),
    destinationAccountId: this.destinationAccountId?.toString(),
    category: this.category,
    description: this.description,
    transactionDate: this.transactionDate,
    referenceId: this.referenceId?.toString(),
    referenceType: this.referenceType,
    status: this.status,
    reversalOfId: this.reversalOfId?.toString(),
    reversedById: this.reversedById?.toString(),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
