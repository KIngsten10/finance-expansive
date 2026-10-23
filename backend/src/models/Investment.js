import mongoose from 'mongoose';

export const INVESTMENT_TYPES = [
  'stock',
  'mutual_fund',
  'etf',
  'fixed_deposit',
  'recurring_deposit',
  'gold',
  'bond',
  'provident_fund',
  'retirement',
  'real_estate',
  'crypto',
  'other',
];
export const INVESTMENT_STATUS = ['open', 'closed'];

/**
 * One manual valuation observation, kept for audit (never overwritten in place).
 */
const valuationEntrySchema = new mongoose.Schema(
  {
    valuePaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'valuePaise must be a non-negative integer (paise)',
      },
    },
    valuationDate: { type: Date, required: true },
    source: { type: String, trim: true },
    isManual: { type: Boolean, default: true },
    recordedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

/**
 * An investment holding owned by a user.
 *
 * Cost basis vs. market value:
 *  - `totalInvestedPaise` is the cost basis (what was actually paid, net of
 *    sales handled by the service). It is always known.
 *  - `currentValuePaise` is the latest MARKET valuation and is OPTIONAL. When it
 *    is null/undefined the current value is UNKNOWN — it must never be treated
 *    as zero or as a verified valuation. Dashboards report known valuations only.
 */
const investmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: [true, 'Investment name is required'], trim: true },
    investmentType: {
      type: String,
      enum: { values: INVESTMENT_TYPES, message: 'Invalid investment type' },
      required: true,
    },
    providerName: { type: String, trim: true },
    identifier: { type: String, trim: true }, // e.g. ticker / folio / ISIN
    notes: { type: String, trim: true, maxlength: [2000, 'Notes are too long'] },
    purchaseDate: { type: Date },
    // Quantity applies to unitized assets (stocks, MF units, grams of gold).
    quantity: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || v >= 0,
        message: 'quantity cannot be negative',
      },
    },
    averageCostPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || (Number.isInteger(v) && v >= 0),
        message: 'averageCostPaise must be a non-negative integer (paise)',
      },
    },
    totalInvestedPaise: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'totalInvestedPaise must be a non-negative integer (paise)',
      },
    },
    // Optional market value. `null` means UNKNOWN, not zero.
    currentValuePaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v == null || (Number.isInteger(v) && v >= 0),
        message: 'currentValuePaise must be a non-negative integer (paise)',
      },
    },
    // Metadata about the latest valuation (manual-only; the app never claims to
    // have verified live market prices).
    valuationDate: { type: Date, default: null },
    valuationSource: { type: String, trim: true, default: null },
    valuationIsManual: { type: Boolean, default: null },
    valuationHistory: { type: [valuationEntrySchema], default: [] },

    // Cumulative accounting totals maintained by the service.
    realizedGainPaise: { type: Number, default: 0 }, // can be negative (loss)
    totalIncomePaise: { type: Number, default: 0 }, // dividends + interest received
    totalFeesPaise: { type: Number, default: 0 }, // all fees across activity

    currency: { type: String, default: 'INR', uppercase: true, trim: true },
    status: {
      type: String,
      enum: { values: INVESTMENT_STATUS, message: 'Invalid investment status' },
      default: 'open',
      index: true,
    },
  },
  { timestamps: true }
);

// Listing filters by user + type/status and sorts by createdAt.
investmentSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const Investment = mongoose.model('Investment', investmentSchema);
export default Investment;
