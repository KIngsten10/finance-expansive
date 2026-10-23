import mongoose from 'mongoose';

export const ACCOUNT_TYPES = ['savings', 'current', 'cash', 'other'];

/**
 * A bank (or cash) account owned by a user. Balances are stored as INTEGER
 * PAISE. `currentBalancePaise` is the authoritative running balance and is only
 * ever mutated through the transaction service so it stays consistent with the
 * Transaction ledger.
 */
const bankAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bankName: { type: String, required: [true, 'Bank name is required'], trim: true },
    accountName: { type: String, required: [true, 'Account name is required'], trim: true },
    accountType: {
      type: String,
      enum: { values: ACCOUNT_TYPES, message: 'Invalid account type' },
      default: 'savings',
    },
    currency: { type: String, default: 'INR', uppercase: true, trim: true },
    openingBalancePaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'openingBalancePaise must be an integer (paise)',
      },
    },
    currentBalancePaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'currentBalancePaise must be an integer (paise)',
      },
    },
    allowOverdraft: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

bankAccountSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    bankName: this.bankName,
    accountName: this.accountName,
    accountType: this.accountType,
    currency: this.currency,
    openingBalancePaise: this.openingBalancePaise,
    currentBalancePaise: this.currentBalancePaise,
    allowOverdraft: this.allowOverdraft,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const BankAccount = mongoose.model('BankAccount', bankAccountSchema);
export default BankAccount;
