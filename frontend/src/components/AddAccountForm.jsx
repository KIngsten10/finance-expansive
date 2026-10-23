import { useState } from 'react';
import { createAccount } from '../api/accounts.js';

const ACCOUNT_TYPES = [
  { value: 'savings', label: 'Savings' },
  { value: 'current', label: 'Current' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

/**
 * Add Bank Account form. Validates required fields, protects against duplicate
 * submissions, and reports success/error via callbacks. Does not collect any
 * sensitive banking data (no account number, PIN, CVV, or password).
 */
export default function AddAccountForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({
    bankName: '',
    accountName: '',
    accountType: 'savings',
    openingBalance: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    const next = {};
    if (!form.bankName.trim()) next.bankName = 'Bank name is required';
    if (!form.accountName.trim()) next.accountName = 'Account name is required';
    const bal = Number(form.openingBalance);
    if (form.openingBalance === '' || Number.isNaN(bal)) next.openingBalance = 'Enter an amount';
    else if (bal < 0) next.openingBalance = 'Opening balance cannot be negative';
    return next;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSubmitting(true);
    try {
      const account = await createAccount({
        bankName: form.bankName.trim(),
        accountName: form.accountName.trim(),
        accountType: form.accountType,
        currency: 'INR',
        openingBalance: Number(form.openingBalance),
      });
      onCreated?.(account);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className="alert alert-danger" role="alert">
          {serverError}
        </div>
      )}

      <div className="mb-3">
        <label htmlFor="bankName" className="form-label">
          Bank name
        </label>
        <input
          id="bankName"
          name="bankName"
          className={`form-control ${errors.bankName ? 'is-invalid' : ''}`}
          value={form.bankName}
          onChange={handleChange}
          disabled={submitting}
        />
        {errors.bankName && <div className="invalid-feedback">{errors.bankName}</div>}
      </div>

      <div className="mb-3">
        <label htmlFor="accountName" className="form-label">
          Account nickname
        </label>
        <input
          id="accountName"
          name="accountName"
          className={`form-control ${errors.accountName ? 'is-invalid' : ''}`}
          value={form.accountName}
          onChange={handleChange}
          disabled={submitting}
        />
        {errors.accountName && <div className="invalid-feedback">{errors.accountName}</div>}
      </div>

      <div className="mb-3">
        <label htmlFor="accountType" className="form-label">
          Account type
        </label>
        <select
          id="accountType"
          name="accountType"
          className="form-select"
          value={form.accountType}
          onChange={handleChange}
          disabled={submitting}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label htmlFor="openingBalance" className="form-label">
          Opening balance (₹)
        </label>
        <input
          id="openingBalance"
          name="openingBalance"
          type="number"
          step="0.01"
          min="0"
          className={`form-control ${errors.openingBalance ? 'is-invalid' : ''}`}
          value={form.openingBalance}
          onChange={handleChange}
          disabled={submitting}
        />
        {errors.openingBalance && (
          <div className="invalid-feedback">{errors.openingBalance}</div>
        )}
      </div>

      <div className="d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              Creating…
            </>
          ) : (
            'Create account'
          )}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
