import { useState } from 'react';
import { createInvestment } from '../api/investments.js';

export const INVESTMENT_TYPES = [
  { value: 'stock', label: 'Stocks' },
  { value: 'mutual_fund', label: 'Mutual Funds' },
  { value: 'etf', label: 'ETF' },
  { value: 'fixed_deposit', label: 'Fixed Deposit' },
  { value: 'recurring_deposit', label: 'Recurring Deposit' },
  { value: 'gold', label: 'Gold' },
  { value: 'bond', label: 'Bonds' },
  { value: 'provident_fund', label: 'Provident Fund' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'crypto', label: 'Cryptocurrency' },
  { value: 'other', label: 'Other' },
];

/**
 * Add Investment PROFILE form. Creating a profile never moves money — the
 * actual purchase is recorded separately.
 */
export default function AddInvestmentForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({
    name: '',
    investmentType: 'mutual_fund',
    providerName: '',
    identifier: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);
    const next = {};
    if (!form.name.trim()) next.name = 'Investment name is required';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      const inv = await createInvestment({
        name: form.name.trim(),
        investmentType: form.investmentType,
        providerName: form.providerName.trim() || undefined,
        identifier: form.identifier.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      onCreated?.(inv);
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
      <div className="alert alert-info py-2 small" role="note">
        Creating an investment profile does <strong>not</strong> deduct money. Record the actual
        purchase separately.
      </div>

      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label htmlFor="inv-name" className="form-label">
            Investment name
          </label>
          <input
            id="inv-name"
            name="name"
            className={`form-control ${errors.name ? 'is-invalid' : ''}`}
            value={form.name}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.name && <div className="invalid-feedback">{errors.name}</div>}
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="inv-type" className="form-label">
            Type
          </label>
          <select
            id="inv-type"
            name="investmentType"
            className="form-select"
            value={form.investmentType}
            onChange={handleChange}
            disabled={submitting}
          >
            {INVESTMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="inv-provider" className="form-label">
            Provider
          </label>
          <input
            id="inv-provider"
            name="providerName"
            className="form-control"
            value={form.providerName}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="inv-identifier" className="form-label">
            Identifier (ticker / folio)
          </label>
          <input
            id="inv-identifier"
            name="identifier"
            className="form-control"
            value={form.identifier}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
        <div className="col-12">
          <label htmlFor="inv-notes" className="form-label">
            Notes
          </label>
          <textarea
            id="inv-notes"
            name="notes"
            rows={2}
            className="form-control"
            value={form.notes}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="mt-3 d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save investment'
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
