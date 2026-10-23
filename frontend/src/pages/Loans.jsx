import { Fragment, useCallback, useEffect, useState } from 'react';
import { listLoans, getLoanSummary } from '../api/loans.js';
import { formatRupees } from '../utils/money.js';
import { useToast } from '../context/ToastContext.jsx';
import { useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AddLoanForm from '../components/AddLoanForm.jsx';
import LoanDetail from '../components/LoanDetail.jsx';

function formatDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
}

const TYPE_LABELS = {
  personal: 'Personal',
  home: 'Home',
  vehicle: 'Vehicle',
  education: 'Education',
  business: 'Business',
  other: 'Other',
};

function SummaryCard({ title, value, subtitle, accent = 'primary' }) {
  return (
    <div className="col-12 col-sm-6 col-xl-3">
      <div className="card shadow-sm h-100">
        <div className="card-body">
          <div className="text-muted small text-uppercase">{title}</div>
          <div className={`h4 mt-2 mb-0 text-${accent}`}>{value}</div>
          {subtitle && <div className="small text-muted mt-1">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Loans() {
  const [loans, setLoans] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const toast = useToast();
  const { requestRefresh } = useDashboardRefresh();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loanData, summaryData] = await Promise.all([
        listLoans({ limit: 50 }),
        getLoanSummary(),
      ]);
      setLoans(loanData.loans);
      setSummary(summaryData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleCreated() {
    setShowForm(false);
    toast.success('Loan created');
    load();
    requestRefresh();
  }

  function handleLoanChanged() {
    load();
    requestRefresh();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Loans</h1>
          <div className="page-subtitle">Track EMIs, outstanding principal, and repayments</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ Add Loan'}
        </button>
      </div>

      {summary && !loading && !error && (
        <div className="row g-3 mb-4">
          <SummaryCard
            title="Total Outstanding"
            value={formatRupees(summary.totalOutstandingPrincipal)}
            accent="warning"
          />
          <SummaryCard title="Total Monthly EMI" value={formatRupees(summary.totalMonthlyEmi)} />
          <SummaryCard title="Active Loans" value={summary.activeLoanCount} accent="info" />
          <SummaryCard
            title="Overdue Payments"
            value={summary.overduePaymentCount}
            accent={summary.overduePaymentCount > 0 ? 'danger' : 'success'}
          />
        </div>
      )}

      {showForm && (
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <h2 className="h6 mb-3">Add a loan</h2>
            <AddLoanForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
          </div>
        </div>
      )}

      {loading && <Spinner label="Loading loans…" />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && loans.length === 0 && (
        <EmptyState
          title="No loans yet"
          message="Add a loan to track EMIs and repayments."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Loan
            </button>
          }
        />
      )}

      {!loading && !error && loans.length > 0 && (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Lender</th>
                  <th>Type</th>
                  <th className="text-end">Original</th>
                  <th className="text-end">Outstanding</th>
                  <th className="text-end">Rate</th>
                  <th className="text-end">EMI</th>
                  <th>Next due</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <Fragment key={loan.id}>
                    <tr>
                      <td>{loan.loanName}</td>
                      <td>{loan.lenderName}</td>
                      <td>{TYPE_LABELS[loan.loanType] || loan.loanType}</td>
                      <td className="text-end">{formatRupees(loan.originalPrincipal)}</td>
                      <td className="text-end">{formatRupees(loan.outstandingPrincipal)}</td>
                      <td className="text-end">{loan.annualInterestRate}%</td>
                      <td className="text-end">
                        {loan.emiAmount != null ? formatRupees(loan.emiAmount) : '—'}
                      </td>
                      <td className="text-nowrap">{formatDate(loan.nextPaymentDate)}</td>
                      <td>
                        <span
                          className={`badge ${loan.status === 'active' ? 'text-bg-success' : 'text-bg-secondary'
                            }`}
                        >
                          {loan.status}
                        </span>
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() =>
                            setExpandedId((id) => (id === loan.id ? null : loan.id))
                          }
                        >
                          {expandedId === loan.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === loan.id && (
                      <tr>
                        <td colSpan={10} style={{ background: 'var(--surface-secondary)' }}>
                          <LoanDetail loan={loan} onChanged={handleLoanChanged} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
