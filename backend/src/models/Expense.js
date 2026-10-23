import mongoose from 'mongoose';

/**
 * Domain record for a daily expense. Always backed by a Transaction (1:1 via
 * transactionId) which carries the ledger/balance effect. The Expense row holds
 * the expense-specific metadata and makes category/date queries convenient.
 */
const expenseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
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
    category: { type: String, trim: true, default: 'uncategorized' },
    description: { type: String, trim: true },
    expenseDate: { type: Date, required: true },
  },
  { timestamps: true }
);

expenseSchema.index({ userId: 1, expenseDate: -1 });

export const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
