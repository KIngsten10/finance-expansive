import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listTransactions } from '../api/transactions.js';
import { listAccounts } from '../api/accounts.js';
import { formatRupees } from '../utils/money.js';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';

const TYPE_OPTIONS = [
  'expense',
  'income',
  'transfer',
  'loan_payment',
  'investment_purchase',
  'investment_sale',
  'adjustment',
];

const TYPE_LABELS = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  loan_payment: 'Loan payment',
  investment_purchase: 'Investment buy',
  investment_sale: 'Investment sell',
  adjustment: 'Adjustment',
};

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export default function Transactions() {
  const [searchParams] = useSearchParams();
  const initialAccount = searchParams.get('accountId') || '';

  const [accounts, setAccounts] = useState([]);
  const [data, setData] = useState({ transactions: [], pagination: {} });
  const [filters, setFilters] = useState({
    accountId: initialAccount,
    type: '',
    startDate: '',
    endDate: '',
    page: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    listAccounts()
      .then(setAccounts)
      .catch(() => { });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: filters.page, limit: 15 };
      if (filters.accountId) params.accountId = filters.accountId;
      if (filters.type) params.type = filters.type;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      setData(await listTransactions(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilters((f) => ({ ...f, [name]: value, page: 1 }));
  }

  const { transactions, pagination } = data;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Transaction History</h1>
          <div className="page-subtitle">Every posted and reversed entry in your ledger</div>
        </div>
      </div>

      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-6 col-md-3">
              <label htmlFor="type" className="form-label small mb-1">
                Type
              </label>
              <select
                id="type"
                name="type"
                className="form-select form-select-sm"
                value={filters.type}
                onChange={handleFilterChange}
              >
                <option value="">All</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="account" className="form-label small mb-1">
                Account
              </label>
              <select
                id="account"
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
          </div>
        </div>
      </div>

      {loading && <Spinner label="Loading transactions…" />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && transactions.length === 0 && (
        <EmptyState title="No transactions found" message="Adjust your filters to see more." />
      )}

      {!loading && !error && transactions.length > 0 && (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Description</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="text-end">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className={t.status === 'reversed' ? 'text-muted' : ''}>
                    <td className="text-nowrap">{formatDate(t.transactionDate)}</td>
                    <td>{TYPE_LABELS[t.type] || t.type}</td>
                    <td>{t.description || <span className="text-muted">—</span>}</td>
                    <td>{t.sourceAccountName || '—'}</td>
                    <td>{t.destinationAccountName || '—'}</td>
                    <td className="text-end text-nowrap">{formatRupees(t.amount)}</td>
                    <td>
                      <span
                        className={`badge ${t.status === 'reversed' ? 'text-bg-secondary' : 'text-bg-success'
                          }`}
                      >
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}
