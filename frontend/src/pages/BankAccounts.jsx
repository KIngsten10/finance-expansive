import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAccounts } from '../api/accounts.js';
import { formatRupees } from '../utils/money.js';
import { useToast } from '../context/ToastContext.jsx';
import { useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AddAccountForm from '../components/AddAccountForm.jsx';

const TYPE_LABELS = { savings: 'Savings', current: 'Current', cash: 'Cash', other: 'Other' };

export default function BankAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { requestRefresh } = useDashboardRefresh();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalBalance = useMemo(
    () => accounts.filter((a) => a.isActive).reduce((sum, a) => sum + (a.currentBalance || 0), 0),
    [accounts]
  );

  function handleCreated() {
    setShowForm(false);
    toast.success('Bank account created');
    load();
    requestRefresh(); // keep the dashboard total in sync
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Bank Accounts</h1>
          <div className="page-subtitle">Manage your accounts and track balances</div>
        </div>
        <button
          type="button"
          className="btn btn-primary d-inline-flex align-items-center gap-2"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? 'Close' : '+ Add Account'}
        </button>
      </div>

      {!loading && !error && (
        <div className="card mb-4">
          <div className="stat-card">
            <span className="stat-label">Total bank balance</span>
            <span className="stat-value fin-figure">{formatRupees(totalBalance)}</span>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <h2 className="h6 mb-3">Add a bank account</h2>
            <AddAccountForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
          </div>
        </div>
      )}

      {loading && <Spinner label="Loading accounts…" />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && accounts.length === 0 && (
        <EmptyState
          title="No bank accounts yet"
          message="Add your first account to start tracking balances."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Account
            </button>
          }
        />
      )}

      {!loading && !error && accounts.length > 0 && (
        <div className="row g-3">
          {accounts.map((a) => (
            <div className="col-12 col-md-6 col-lg-4" key={a.id}>
              <div className="card shadow-sm h-100">
                <div className="card-body d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-semibold">{a.accountName}</div>
                      <div className="text-muted small">{a.bankName}</div>
                    </div>
                    <span className={`badge ${a.isActive ? 'text-bg-success' : 'text-bg-secondary'}`}>
                      {a.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="mt-3">
                    <span className="badge text-bg-light me-2">
                      {TYPE_LABELS[a.accountType] || a.accountType}
                    </span>
                  </div>

                  <div className="mt-3 mb-3">
                    <div className="text-muted small">Current balance</div>
                    <div className="h5 mb-0">{formatRupees(a.currentBalance)}</div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm mt-auto"
                    onClick={() => navigate(`/transactions?accountId=${a.id}`)}
                  >
                    View Transactions
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
