import { useEffect, useMemo, useState } from 'react';
import { recordLoanPayment } from '../api/loans.js';
import { listAccounts } from '../api/accounts.js';
import { formatRupees } from '../utils/money.js';
import { newIdempotencyKey } from '../utils/idempotency.js';

function todayIso() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/**
 * Record EMI Payment form. The user enters the principal/interest split (we
 * never guess the lender's allocation). Total = principal + interest is shown
 * live and must match. Warns on insufficient funds or overpayment. Uses an
 * idempotency key and guards against duplicate submissions.
 */
export default function RecordLoanPaymentForm({ loan, onRecorded }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    accountId: '',
    principalPaid: '',
    interestPaid: '',
    paymentDate: todayIso(),
    description: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    listAccounts()
      .then((list) => {
        const active = list.filter((a) => a.isActive);
        setAccounts(active);
        if (active[0]) setForm((f) => ({ ...f, accountId: f.accountId || active[0].id }));
      })
      .catch((err) => setServerError(err.message));
  }, []);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === form.accountId),
    [accounts, form.accountId]
  );

  const principal = Number(form.principalPaid) || 0;
  const interest = Number(form.interestPaid) || 0;
  const total = Math.round((principal + interest) * 100) / 100;

  const insufficientFunds =
    selectedAccount != null && total > 0 && selectedAccount.currentBalance < total;
  const exceedsPrincipal = principal > (loan?.outstandingPrincipal ?? Infinity);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    const next = {};
    if (!form.accountId) next.accountId = 'Select a payment account';
    if (principal < 0) next.principalPaid = 'Principal cannot be negative';
    if (interest < 0) next.interestPaid = 'Interest cannot be negative';
    if (total <= 0) next.principalPaid = 'Enter a payment amount';
    if (!form.paymentDate) next.paymentDate = 'Select a date';
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
      const result = await recordLoanPayment(
        loan.id,
        {
          accountId: form.accountId,
          principalPaid: principal,
          interestPaid: interest,
          paymentAmount: total,
          paymentDate: form.paymentDate,
          description: form.description.trim() || undefined,
        },
        idemKey
      );
      setForm((f) => ({ ...f, principalPaid: '', interestPaid: '', description: '' }));
      setIdemKey(newIdempotencyKey());
      onRecorded?.(result);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="alert alert-warning mb-0" role="alert">
        You need an active bank account to record a payment.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <div className="alert alert-danger" role="alert">
          {serverError}
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label htmlFor="pay-account" className="form-label">
            Payment account
          </label>
          <select
            id="pay-account"
            name="accountId"
            className={`form-select ${errors.accountId ? 'is-invalid' : ''}`}
            value={form.accountId}
            onChange={handleChange}
            disabled={submitting}
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountName} ({a.bankName})
              </option>
            ))}
          </select>
          {selectedAccount && (
            <div className="form-text">
              Available balance: {formatRupees(selectedAccount.currentBalance)}
            </div>
          )}
          {errors.accountId && <div className="invalid-feedback">{errors.accountId}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="pay-date" className="form-label">
            Payment date
          </label>
          <input
            id="pay-date"
            name="paymentDate"
            type="date"
            className={`form-control ${errors.paymentDate ? 'is-invalid' : ''}`}
            value={form.paymentDate}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.paymentDate && <div className="invalid-feedback">{errors.paymentDate}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="principalPaid" className="form-label">
            Principal component (₹)
          </label>
          <input
            id="principalPaid"
            name="principalPaid"
            type="number"
            min="0"
            step="0.01"
            className={`form-control ${errors.principalPaid ? 'is-invalid' : ''}`}
            value={form.principalPaid}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.principalPaid && <div className="invalid-feedback">{errors.principalPaid}</div>}
        </div>

        <div className="col-12 col-md-6">
          <label htmlFor="interestPaid" className="form-label">
            Interest component (₹)
          </label>
          <input
            id="interestPaid"
            name="interestPaid"
            type="number"
            min="0"
            step="0.01"
            className={`form-control ${errors.interestPaid ? 'is-invalid' : ''}`}
            value={form.interestPaid}
            onChange={handleChange}
            disabled={submitting}
          />
          {errors.interestPaid && <div className="invalid-feedback">{errors.interestPaid}</div>}
        </div>

        <div className="col-12">
          <label htmlFor="pay-desc" className="form-label">
            Description (optional)
          </label>
          <input
            id="pay-desc"
            name="description"
            className="form-control"
            value={form.description}
            onChange={handleChange}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="mt-3 d-flex flex-wrap align-items-center gap-3">
        <span>
          Total payment: <strong>{formatRupees(total)}</strong>
        </span>
        {insufficientFunds && (
          <span className="text-danger small">Insufficient funds in the selected account.</span>
        )}
        {exceedsPrincipal && (
          <span className="text-warning small">
            Principal exceeds the remaining outstanding balance.
          </span>
        )}
      </div>

      <div className="mt-3">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              Recording…
            </>
          ) : (
            'Record payment'
          )}
        </button>
      </div>
    </form>
  );
}
