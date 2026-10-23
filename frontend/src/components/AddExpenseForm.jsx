import { useEffect, useMemo, useState } from 'react';
import { createExpense } from '../api/expenses.js';
import { newIdempotencyKey } from '../utils/idempotency.js';

export const DEFAULT_CATEGORIES = [
  'Food',
  'Travel',
  'Fuel',
  'Shopping',
  'Bills',
  'Rent',
  'Healthcare',
  'Entertainment',
  'Education',
  'EMI Interest',
  'Other',
];

function todayIso() {
  // Local date in YYYY-MM-DD for the date input default.
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

/**
 * Add Expense form. Payment account must be one of the user's ACTIVE accounts.
 * Supports a custom category. Uses a per-submission idempotency key and guards
 * against duplicate submissions.
 */
export default function AddExpenseForm({ accounts, onCreated }) {
  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);

  const [form, setForm] = useState({
    amount: '',
    category: 'Food',
    customCategory: '',
    accountId: activeAccounts[0]?.id || '',
    expenseDate: todayIso(),
    description: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [serverDetails, setServerDetails] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // A stable key per logical submission; regenerated after success.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  const usingCustom = form.category === '__custom';

  // Accounts may load after this form mounts; default to the first active one
  // once it is available (without clobbering a user's explicit selection).
  useEffect(() => {
    if (!form.accountId && activeAccounts.length > 0) {
      setForm((f) => ({ ...f, accountId: activeAccounts[0].id }));
    }
  }, [activeAccounts, form.accountId]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    const next = {};
    const amt = Number(form.amount);
    if (form.amount === '' || Number.isNaN(amt)) next.amount = 'Enter an amount';
    else if (amt <= 0) next.amount = 'Amount must be greater than zero';

    const category = usingCustom ? form.customCategory.trim() : form.category;
    if (!category) next.category = 'Category is required';
    if (!form.accountId) next.accountId = 'Select a payment account';
    if (!form.expenseDate) next.expenseDate = 'Select a date';
    return next;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);
    setServerDetails([]);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    const category = usingCustom ? form.customCategory.trim() : form.category;

    setSubmitting(true);
    try {
      const result = await createExpense(
        {
          amount: Number(form.amount),
          category,
          accountId: form.accountId,
          description: form.description.trim() || undefined,
          expenseDate: form.expenseDate,
        },
        idemKey
      );
      // Reset for the next entry and rotate the idempotency key.
      setForm((f) => ({ ...f, amount: '', description: '' }));
      setIdemKey(newIdempotencyKey());
      onCreated?.(result);
    } catch (err) {
      setServerError(err.message);
      if (Array.isArray(err.details)) setServerDetails(err.details);
    } finally {
      setSubmitting(false);
    }
  }

  if (activeAccounts.length === 0) {
    return (
      <div className="alert alert-warning mb-0" role="alert">
        You need an active bank account before adding expenses.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className="alert alert-danger" role="alert">
          {serverError}
          {serverDetails.length > 0 && (
            <ul className="mb-0 mt-2">
              {serverDetails.map((d, i) => (
                <li key={i}>{d.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-md-4">
          <label htmlFor="amount" className="form-label">
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            className={`form-control ${errors.amount ? 'is-invalid' : ''}`}
            value={form.amount}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.amount && <div className="invalid-feedback">{errors.amount}</div>}
        </div>

        <div className="col-12 col-md-4">
          <label htmlFor="category" className="form-label">
            Category
          </label>
          <select
            id="category"
            name="category"
            className={`form-select ${errors.category ? 'is-invalid' : ''}`}
            value={form.category}
            onChange={handleChange}
            disabled={submitting}
          >
            {DEFAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
          {usingCustom && (
            <input
              name="customCategory"
              className={`form-control mt-2 ${errors.category ? 'is-invalid' : ''}`}
              placeholder="Custom category"
              value={form.customCategory}
              onChange={handleChange}
              disabled={submitting}
            />
          )}
          {errors.category && <div className="invalid-feedback d-block">{errors.category}</div>}
        </div>

        <div className="col-12 col-md-4">
          <label htmlFor="accountId" className="form-label">
            Payment account
          </label>
          <select
            id="accountId"
            name="accountId"
            className={`form-select ${errors.accountId ? 'is-invalid' : ''}`}
            value={form.accountId}
            onChange={handleChange}
            disabled={submitting}
          >
            <option value="">Select…</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountName} ({a.bankName})
              </option>
            ))}
          </select>
          {errors.accountId && <div className="invalid-feedback">{errors.accountId}</div>}
        </div>

        <div className="col-12 col-md-4">
          <label htmlFor="expenseDate" className="form-label">
            Date
          </label>
          <input
            id="expenseDate"
            name="expenseDate"
            type="date"
            className={`form-control ${errors.expenseDate ? 'is-invalid' : ''}`}
            value={form.expenseDate}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.expenseDate && <div className="invalid-feedback">{errors.expenseDate}</div>}
        </div>

        <div className="col-12 col-md-8">
          <label htmlFor="description" className="form-label">
            Description (optional)
          </label>
          <input
            id="description"
            name="description"
            className="form-control"
            value={form.description}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="mt-3">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Add expense'
          )}
        </button>
      </div>
    </form>
  );
}
