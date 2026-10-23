import mongoose from 'mongoose';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * User account. Passwords are never stored in plaintext — only `passwordHash`
 * is persisted, and it is excluded from queries by default (`select: false`).
 * Timestamps add createdAt/updatedAt automatically.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [1, 'Name is required'],
      maxlength: [120, 'Name must be at most 120 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [EMAIL_REGEX, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never loaded unless explicitly requested
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Serialize a safe view of the user — no passwordHash, no __v. Used for all
 * API responses so sensitive fields can never leak.
 */
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    currency: this.currency,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// Defensive default: strip sensitive fields from any accidental JSON serialization.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
export default User;
