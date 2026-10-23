import { useEffect, useMemo, useState } from 'react';
import { listAccounts } from '../api/accounts.js';
import {
  recordPurchase,
  recordSale,
  recordIncome,
  recordFee,
  updateValuation,
} from '../api/investments.js';
import { formatRupees } from '../utils/money.js';
import { newIdempotencyKey } from '../utils/idempotency.js';

function todayIso() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

const TITLES = {
  purchase: 'Record Purchase',
  sale: 'Record Sale',
  income: 'Record Dividend / Interest',
  fee: 'Record Fee',
  valuation: 'Update Valuation',
};

/**
 * Modal for an investment financial operation. `op` selects the mode. Account
 * selection applies to purchase/sale/income/fee (not valuation). Uses an
 * idempotency key for financial writes and prevents duplicate submissions.
 */
export default function InvestmentOpModal({ op, investment, onDone, onCancel }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    accountId: '',
    amount: '',
    grossProceeds: '',
    fee: '',
    quantity: '',
    unitPrice: '',
    incomeType: 'dividend',
    currentValue: '',
    source: '',
    description: '',
    date: todayIso(),
  });
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey] = useState(() => newIdempotencyKey());

  const needsAccount = op !== 'valuation';

  useEffect(() => {
    if (!needsAccount) return;
    listAccounts()
      .then((list) => {
        const active = list.filter((a) => a.isActive);
        setAccounts(active);
        if (active[0]) setForm((f) => ({ ...f, accountId: f.accountId || active[0].id }));
      })
      .catch((err) => setServerError(err.message));
  }, [needsAccount]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === form.accountId),
    [accounts, form.accountId]
  );

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function validate() {
    if (needsAccount && !form.accountId) return 'Select an account';
    if (op === 'purchase' && (!form.amount || Number(form.amount) <= 0)) return 'Enter a purchase amount';
    if (op === 'sale' && (!form.grossProceeds || Number(form.grossProceeds) <= 0))
      return 'Enter gross proceeds';
    if ((op === 'income' || op === 'fee') && (!form.amount || Number(form.amount) <= 0))
      return 'Enter an amount';
    if (op === 'valuation' && (form.currentValue === '' || Number(form.currentValue) < 0))
      return 'Enter a non-negative value';
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);
    const err = validate();
    if (err) {
      setServerError(err);
      return;
    }

    setSubmitting(true);
    try {
      const id = investment.id;
      if (op === 'purchase') {
        await recordPurchase(
          id,
          {
            accountId: form.accountId,
            amount: Number(form.amount),
            fee: form.fee ? Number(form.fee) : undefined,
            quantity: form.quantity ? Number(form.quantity) : undefined,
            unitPrice: form.unitPrice ? Number(form.unitPrice) : undefined,
            description: form.description.trim() || undefined,
            purchaseDate: form.date,
          },
          idemKey
        );
      } else if (op === 'sale') {
        await recordSale(
          id,
          {
            accountId: form.accountId,
            grossProceeds: Number(form.grossProceeds),
            fee: form.fee ? Number(form.fee) : undefined,
            quantity: form.quantity ? Number(form.quantity) : undefined,
            description: form.description.trim() || undefined,
            saleDate: form.date,
          },
          idemKey
        );
      } else if (op === 'income') {
        await recordIncome(
          id,
          {
            accountId: form.accountId,
            amount: Number(form.amount),
            incomeType: form.incomeType,
            description: form.description.trim() || undefined,
            incomeDate: form.date,
          },
          idemKey
        );
      } else if (op === 'fee') {
        await recordFee(
          id,
          {
            accountId: form.accountId,
            amount: Number(form.amount),
            description: form.description.trim() || undefined,
            feeDate: form.date,
          },
          idemKey
        );
      } else if (op === 'valuation') {
        await updateValuation(id, {
          currentValue: Number(form.currentValue),
          valuationDate: form.date,
          source: form.source.trim() || undefined,
        });
      }
      onDone?.();
    } catch (ex) {
      setServerError(ex.message);
    } finally {
      setSubmitting(false);
    }
  }

  const accountField = needsAccount && (
    <div className="mb-3">
      <label htmlFor="op-account" className="form-label">
        {op === 'sale' || op === 'income' ? 'Destination account' : 'Funding account'}
      </label>
      <select
        id="op-account"
        name="accountId"
        className="form-select"
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
        <div className="form-text">Available: {formatRupees(selectedAccount.currentBalance)}</div>
      )}
    </div>
  );

  return (
    <>
      <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="op-title">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <form onSubmit={handleSubmit} noValidate>
              <div className="modal-header">
                <h5 className="modal-title" id="op-title">
                  {TITLES[op]} — {investment.name}
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={onCancel} />
              </div>
              <div className="modal-body">
                {serverError && (
                  <div className="alert alert-danger" role="alert">
                    {serverError}
                  </div>
                )}

                {accountField}

                {op === 'purchase' && (
                  <>
                    <div className="mb-3">
                      <label htmlFor="amount" className="form-label">Amount (₹)</label>
                      <input id="amount" name="amount" type="number" min="0" step="0.01"
                        className="form-control" value={form.amount} onChange={handleChange} disabled={submitting} />
                    </div>
                    <div className="row g-2">
                      <div className="col-6">
                        <label htmlFor="quantity" className="form-label">Quantity</label>
                        <input id="quantity" name="quantity" type="number" min="0" step="any"
                          className="form-control" value={form.quantity} onChange={handleChange} disabled={submitting} />
                      </div>
                      <div className="col-6">
                        <label htmlFor="fee" className="form-label">Fee (₹)</label>
                        <input id="fee" name="fee" type="number" min="0" step="0.01"
                          className="form-control" value={form.fee} onChange={handleChange} disabled={submitting} />
                      </div>
                    </div>
                  </>
                )}

                {op === 'sale' && (
                  <>
                    <div className="mb-3">
                      <label htmlFor="grossProceeds" className="form-label">Gross proceeds (₹)</label>
                      <input id="grossProceeds" name="grossProceeds" type="number" min="0" step="0.01"
                        className="form-control" value={form.grossProceeds} onChange={handleChange} disabled={submitting} />
                    </div>
                    <div className="row g-2">
                      <div className="col-6">
                        <label htmlFor="quantity" className="form-label">Quantity sold</label>
                        <input id="quantity" name="quantity" type="number" min="0" step="any"
                          className="form-control" value={form.quantity} onChange={handleChange} disabled={submitting} />
                      </div>
                      <div className="col-6">
                        <label htmlFor="fee" className="form-label">Fee (₹)</label>
                        <input id="fee" name="fee" type="number" min="0" step="0.01"
                          className="form-control" value={form.fee} onChange={handleChange} disabled={submitting} />
                      </div>
                    </div>
                  </>
                )}

                {op === 'income' && (
                  <>
                    <div className="mb-3">
                      <label htmlFor="amount" className="form-label">Amount (₹)</label>
                      <input id="amount" name="amount" type="number" min="0" step="0.01"
                        className="form-control" value={form.amount} onChange={handleChange} disabled={submitting} />
                    </div>
                    <div className="mb-3">
                      <label htmlFor="incomeType" className="form-label">Income type</label>
                      <select id="incomeType" name="incomeType" className="form-select"
                        value={form.incomeType} onChange={handleChange} disabled={submitting}>
                        <option value="dividend">Dividend</option>
                        <option value="interest">Interest</option>
                      </select>
                    </div>
                  </>
                )}

                {op === 'fee' && (
                  <div className="mb-3">
                    <label htmlFor="amount" className="form-label">Fee amount (₹)</label>
                    <input id="amount" name="amount" type="number" min="0" step="0.01"
                      className="form-control" value={form.amount} onChange={handleChange} disabled={submitting} />
                  </div>
                )}

                {op === 'valuation' && (
                  <>
                    <div className="mb-3">
                      <label htmlFor="currentValue" className="form-label">Current value (₹)</label>
                      <input id="currentValue" name="currentValue" type="number" min="0" step="0.01"
                        className="form-control" value={form.currentValue} onChange={handleChange} disabled={submitting} />
                    </div>
                    <div className="mb-3">
                      <label htmlFor="source" className="form-label">Source / notes</label>
                      <input id="source" name="source" className="form-control"
                        value={form.source} onChange={handleChange} disabled={submitting} />
                    </div>
                    <div className="alert alert-secondary py-2 small mb-3">
                      This is a manually entered valuation. The app does not fetch live market prices.
                    </div>
                  </>
                )}

                <div className="mb-3">
                  <label htmlFor="op-date" className="form-label">Date</label>
                  <input id="op-date" name="date" type="date" className="form-control"
                    value={form.date} onChange={handleChange} disabled={submitting} />
                </div>

                {op !== 'valuation' && (
                  <div className="mb-1">
                    <label htmlFor="op-desc" className="form-label">Description</label>
                    <input id="op-desc" name="description" className="form-control"
                      value={form.description} onChange={handleChange} disabled={submitting} />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}
