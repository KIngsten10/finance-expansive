import { useState } from 'react';
import { createLoan, calculateEmi } from '../api/loans.js';
import { formatRupees } from '../utils/money.js';

const LOAN_TYPES = [
  { value: 'personal', label: 'Personal' },
  { value: 'home', label: 'Home' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'education', label: 'Education' },
  { value: 'business', label: 'Business' },
  { value: 'other', label: 'Other' },
];

/**
 * Add Loan form with a Calculate EMI action. Registering a loan records the
 * liability only — it never creates a bank transaction. The user can accept the
 * estimated EMI or enter the lender-provided EMI.
 */
export default function AddLoanForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({
    lenderName: '',
    loanName: '',
    loanType: 'personal',
    originalPrincipal: '',
    annualInterestRate: '',
    startDate: '',
    tenureMonths: '',
    firstPaymentDate: '',
    emiAmount: '',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    const next = {};
    if (!form.lenderName.trim()) next.lenderName = 'Lender name is required';
    if (!form.loanName.trim()) next.loanName = 'Loan name is required';
    if (!form.originalPrincipal || Number(form.originalPrincipal) <= 0)
      next.originalPrincipal = 'Enter a positive principal';
    if (form.annualInterestRate === '' || Number(form.annualInterestRate) < 0)
      next.annualInterestRate = 'Enter a valid interest rate';
    if (!form.tenureMonths || Number(form.tenureMonths) < 1)
      next.tenureMonths = 'Enter the tenure in months';
    if (!form.startDate) next.startDate = 'Select a start date';
    return next;
  }

  async function handleCalculate() {
    const needed = {};
    if (!form.originalPrincipal || Number(form.originalPrincipal) <= 0)
      needed.originalPrincipal = 'Enter a principal';
    if (form.annualInterestRate === '') needed.annualInterestRate = 'Enter a rate';
    if (!form.tenureMonths) needed.tenureMonths = 'Enter the tenure';
    setErrors(needed);
    if (Object.keys(needed).length) return;

    setEstimating(true);
    setServerError(null);
    try {
      const result = await calculateEmi({
        principal: Number(form.originalPrincipal),
        annualInterestRate: Number(form.annualInterestRate),
        tenureMonths: Number(form.tenureMonths),
      });
      setEstimate(result);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setEstimating(false);
    }
  }

  function useEstimatedEmi() {
    if (estimate) setForm((f) => ({ ...f, emiAmount: String(estimate.estimatedEmi) }));
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
      const loan = await createLoan({
        lenderName: form.lenderName.trim(),
        loanName: form.loanName.trim(),
        loanType: form.loanType,
        originalPrincipal: Number(form.originalPrincipal),
        annualInterestRate: Number(form.annualInterestRate),
        startDate: form.startDate,
        tenureMonths: Number(form.tenureMonths),
        firstPaymentDate: form.firstPaymentDate || undefined,
        emiAmount: form.emiAmount ? Number(form.emiAmount) : undefined,
        notes: form.notes.trim() || undefined,
      });
      onCreated?.(loan);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name, label, type = 'text', extra = {}) => (
    <div className="col-12 col-md-6">
      <label htmlFor={name} className="form-label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        className={`form-control ${errors[name] ? 'is-invalid' : ''}`}
        value={form[name]}
        onChange={handleChange}
        disabled={submitting}
        {...extra}
      />
      {errors[name] && <div className="invalid-feedback">{errors[name]}</div>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className="alert alert-danger" role="alert">
          {serverError}
        </div>
      )}

      <div className="alert alert-info py-2 small" role="note">
        Registering a loan records the liability only. It does <strong>not</strong> record a
        repayment or change any bank balance.
      </div>

      <div className="row g-3">
        {field('lenderName', 'Lender name')}
        {field('loanName', 'Loan name')}

        <div className="col-12 col-md-6">
          <label htmlFor="loanType" className="form-label">
            Loan type
          </label>
          <select
            id="loanType"
            name="loanType"
            className="form-select"
            value={form.loanType}
            onChange={handleChange}
            disabled={submitting}
          >
            {LOAN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {field('originalPrincipal', 'Original principal (₹)', 'number', { min: 0, step: '0.01' })}
        {field('annualInterestRate', 'Annual interest rate (%)', 'number', { min: 0, step: '0.01' })}
        {field('tenureMonths', 'Tenure (months)', 'number', { min: 1, step: 1 })}
        {field('startDate', 'Start date', 'date')}
        {field('firstPaymentDate', 'First EMI date', 'date')}
        {field('emiAmount', 'EMI amount (₹)', 'number', { min: 0, step: '0.01' })}

        <div className="col-12">
          <label htmlFor="notes" className="form-label">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            className="form-control"
            rows={2}
            value={form.notes}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="mt-3 d-flex flex-wrap gap-2 align-items-center">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleCalculate}
          disabled={estimating || submitting}
        >
          {estimating ? 'Calculating…' : 'Calculate EMI'}
        </button>

        {estimate && (
          <div className="small">
            Estimated EMI: <strong>{formatRupees(estimate.estimatedEmi)}</strong> · Total:{' '}
            {formatRupees(estimate.totalRepayment)} · Interest:{' '}
            {formatRupees(estimate.totalInterest)}{' '}
            <button type="button" className="btn btn-link btn-sm p-0" onClick={useEstimatedEmi}>
              Use this EMI
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save loan'
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
