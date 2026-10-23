import { useCallback, useEffect, useState } from 'react';
import { listAccounts } from '../api/accounts.js';
import { listExpenses, reverseExpense } from '../api/expenses.js';
import { formatRupees } from '../utils/money.js';
import { useToast } from '../context/ToastContext.jsx';
import { useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import AddExpenseForm, { DEFAULT_CATEGORIES } from '../components/AddExpenseForm.jsx';

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

const EMPTY_FILTERS = {
  startDate: '',
  endDate: '',
  category: '',
  accountId: '',
  page: 1,
};

export default function Expenses() {
  const [accounts, setAccounts] = useState([]);
  const [data, setData] = useState({ expenses: [], pagination: {}, totalMatchingAmount: 0 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { expenseId }
  const [reversing, setReversing] = useState(false);

  const toast = useToast();
  const { requestRefresh } = useDashboardRefresh();

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.category) params.category = filters.category;
      if (filters.accountId) params.accountId = filters.accountId;
      params.page = filters.page;
      params.limit = 10;
      setData(await listExpenses(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilters((f) => ({ ...f, [name]: value, page: 1 }));
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  async function handleCreated() {
    toast.success('Expense recorded');
    setFilters((f) => ({ ...f, page: 1 }));
    await loadExpenses();
    await loadAccounts();
    requestRefresh();
  }

  async function confirmReverse() {
    if (!confirm) return;
    setReversing(true);
    try {
      await reverseExpense(confirm.expenseId);
      toast.success('Expense reversed');
      setConfirm(null);
      await loadExpenses();
      await loadAccounts();
      requestRefresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReversing(false);
    }
  }

  const { expenses, pagination, totalMatchingAmount } = data;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <div className="page-subtitle">Track daily spending and corrections</div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="section-title">Add an expense</h2>
          <AddExpenseForm accounts={accounts} onCreated={handleCreated} />
        </div>
      </div>

      {/* Filters */}
      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-6 col-md-3">
              <label htmlFor="startDate" className="form-label small mb-1">
                From
              </label>
              <input
                id="startDate"
                type="date"
                name="startDate"
                className="form-control form-control-sm"
                value={filters.startDate}
                onChange={handleFilterChange}
              />
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="endDate" className="form-label small mb-1">
                To
              </label>
              <input
                id="endDate"
                type="date"
                name="endDate"
                className="form-control form-control-sm"
                value={filters.endDate}
                onChange={handleFilterChange}
              />
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="filterCategory" className="form-label small mb-1">
                Category
              </label>
              <select
                id="filterCategory"
                name="category"
                className="form-select form-select-sm"
                value={filters.category}
                onChange={handleFilterChange}
              >
                <option value="">All</option>
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="filterAccount" className="form-label small mb-1">
                Account
              </label>
              <select
                id="filterAccount"
                name="accountId"
                className="form-select form-select-sm"
                value={filters.accountId}
                onChange={handleFilterChange}
              >
                <option value="">All</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2 d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-link btn-sm px-0" onClick={resetFilters}>
              Clear filters
            </button>
            <span className="text-muted small">
              Total (filtered): <strong>{formatRupees(totalMatchingAmount)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* History table */}
      {loading && <Spinner label="Loading expenses…" />}
      {error && <ErrorState message={error} onRetry={loadExpenses} />}

      {!loading && !error && expenses.length === 0 && (
        <EmptyState title="No expenses found" message="Try adjusting your filters or add an expense above." />
      )}

      {!loading && !error && expenses.length > 0 && (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Category</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="text-end">
                    Amount
                  </th>
                  <th scope="col" className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className={e.status === 'reversed' ? 'text-muted' : ''}>
                    <td>{formatDate(e.expenseDate)}</td>
                    <td>
                      {e.description || <span className="text-muted">—</span>}
                      {e.status === 'reversed' && (
                        <span className="badge text-bg-secondary ms-2">Reversed</span>
                      )}
                    </td>
                    <td>{e.category}</td>
                    <td>{e.accountName || '—'}</td>
                    <td className="text-end">{formatRupees(e.amount)}</td>
                    <td className="text-end">
                      {e.status !== 'reversed' ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => setConfirm({ expenseId: e.id })}
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

          {/* Pagination */}
          <div className="card-footer d-flex justify-content-between align-items-center">
            <span className="text-muted small">
              Page {pagination.page} of {pagination.totalPages || 1} ({pagination.totalCount} total)
            </span>
            <div className="btn-group">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={pagination.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={pagination.page >= (pagination.totalPages || 1)}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        title="Reverse this expense?"
        message="This restores the account balance and keeps the original record for audit. This cannot be undone."
        confirmLabel="Reverse expense"
        busy={reversing}
        onConfirm={confirmReverse}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
