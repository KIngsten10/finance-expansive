import { useCallback, useEffect, useState } from 'react';
import { getLoanSchedule, listLoanPayments, reverseLoanPayment, closeLoan } from '../api/loans.js';
import { formatRupees } from '../utils/money.js';
import { useToast } from '../context/ToastContext.jsx';
import Spinner from './Spinner.jsx';
import ErrorState from './ErrorState.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import RecordLoanPaymentForm from './RecordLoanPaymentForm.jsx';

function formatDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
}

const STATUS_BADGE = {
  paid: 'text-bg-success',
  partially_paid: 'text-bg-info',
  due: 'text-bg-warning',
  overdue: 'text-bg-danger',
  upcoming: 'text-bg-secondary',
};

/**
 * Loan detail: repayment schedule, payment history (with reversal), and the
 * record-payment form. After any mutation it calls onChanged so the parent can
 * refresh the loan list + dashboard.
 */
export default function LoanDetail({ loan, onChanged }) {
  const [schedule, setSchedule] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { paymentId }
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sch, pay] = await Promise.all([
        getLoanSchedule(loan.id),
        listLoanPayments(loan.id, { limit: 20 }),
      ]);
      setSchedule(sch.installments);
      setPayments(pay.payments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loan.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRecorded() {
    toast.success('Loan payment recorded');
    await load();
    onChanged?.();
  }

  async function confirmReverse() {
    if (!confirm) return;
    setBusy(true);
    try {
      await reverseLoanPayment(loan.id, confirm.paymentId);
      toast.success('Payment reversed');
      setConfirm(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      await closeLoan(loan.id);
      toast.success('Loan closed');
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div
      className="border rounded p-3 mt-2"
      style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
    >
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <div className="fw-semibold">{loan.loanName}</div>
          <div className="text-muted small">
            {loan.lenderName} · {loan.loanType} · {loan.annualInterestRate}% p.a.
          </div>
          <div className="small mt-1">
            Outstanding: <strong>{formatRupees(loan.outstandingPrincipal)}</strong> of{' '}
            {formatRupees(loan.originalPrincipal)} · EMI:{' '}
            {loan.emiAmount != null ? formatRupees(loan.emiAmount) : '—'} · Next due:{' '}
            {formatDate(loan.nextPaymentDate)}
          </div>
        </div>
        {loan.status === 'active' && loan.outstandingPrincipal === 0 && (
          <button
            type="button"
            className="btn btn-sm btn-outline-success"
            onClick={handleClose}
            disabled={closing}
          >
            {closing ? 'Closing…' : 'Close loan'}
          </button>
        )}
      </div>

      {loan.status === 'active' && (
        <div className="mb-4">
          <h3 className="h6">Record EMI payment</h3>
          <RecordLoanPaymentForm loan={loan} onRecorded={handleRecorded} />
        </div>
      )}

      {loading && <Spinner label="Loading loan details…" />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <h3 className="h6 mt-3">Repayment schedule (estimated)</h3>
          <div className="table-responsive mb-4" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due</th>
                  <th className="text-end">Scheduled</th>
                  <th className="text-end">Interest</th>
                  <th className="text-end">Principal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((i) => (
                  <tr key={i.installment}>
                    <td>{i.installment}</td>
                    <td className="text-nowrap">{formatDate(i.dueDate)}</td>
                    <td className="text-end">{formatRupees(i.scheduledPayment)}</td>
                    <td className="text-end">{formatRupees(i.estimatedInterest)}</td>
                    <td className="text-end">{formatRupees(i.estimatedPrincipal)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[i.status] || 'text-bg-light'}`}>
                        {i.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="h6">Payment history</h3>
          {payments.length === 0 ? (
            <p className="text-muted">No payments recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-end">Total</th>
                    <th className="text-end">Principal</th>
                    <th className="text-end">Interest</th>
                    <th>Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className={p.status === 'reversed' ? 'text-muted' : ''}>
                      <td className="text-nowrap">{formatDate(p.paymentDate)}</td>
                      <td className="text-end">{formatRupees(p.paymentAmount)}</td>
                      <td className="text-end">{formatRupees(p.principalPaid)}</td>
                      <td className="text-end">{formatRupees(p.interestPaid)}</td>
                      <td>
                        <span
                          className={`badge ${p.status === 'reversed' ? 'text-bg-secondary' : 'text-bg-success'
                            }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="text-end">
                        {p.status === 'posted' && !p.reversalOfId ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => setConfirm({ paymentId: p.id })}
                          >
                            Reverse
                          </button>
                        ) : (
                          <span className="text-muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        title="Reverse this payment?"
        message="This restores the bank balance and loan principal and reverses the interest expense. The original records are preserved for audit."
        confirmLabel="Reverse payment"
        busy={busy}
        onConfirm={confirmReverse}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
