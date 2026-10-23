import mongoose from 'mongoose';

export const INVESTMENT_TXN_TYPES = ['purchase', 'sale', 'dividend', 'interest', 'fee'];

/**
 * An activity against an Investment (buy/sell/income/fee), backed by a ledger
 * Transaction. A purchase funds from a bank account and increases cost basis;
 * a sale returns money to a bank account and realizes gains/losses.
 */
const investmentTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    investmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investment',
      required: true,
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
    },
    // Optional: income retained within the investment (not paid to a bank) and
    // certain reversals have no bank account.
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
      default: null,
    },
    type: {
      type: String,
      enum: { values: INVESTMENT_TXN_TYPES, message: 'Invalid investment transaction type' },
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
    feePaise: {
      type: Number,
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'feePaise must be a non-negative integer (paise)',
      },
    },
    unitPricePaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || (Number.isInteger(v) && v >= 0),
        message: 'unitPricePaise must be a non-negative integer (paise)',
      },
    },
    // Realized gain snapshot for sales (can be negative). Null for non-sales.
    realizedGainPaise: { type: Number, default: null },
    quantity: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || v >= 0,
        message: 'quantity cannot be negative',
      },
    },
    description: { type: String, trim: true },
    transactionDate: { type: Date, required: true },
    status: {
      type: String,
      enum: { values: ['posted', 'reversed'], message: 'Invalid status' },
      default: 'posted',
      index: true,
    },
    reversedById: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestmentTransaction' },
    reversalOfId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestmentTransaction' },
  },
  { timestamps: true }
);

investmentTransactionSchema.index({ userId: 1, transactionDate: -1 });
investmentTransactionSchema.index({ userId: 1, investmentId: 1, transactionDate: -1 });

export const InvestmentTransaction = mongoose.model(
  'InvestmentTransaction',
  investmentTransactionSchema
);
export default InvestmentTransaction;
