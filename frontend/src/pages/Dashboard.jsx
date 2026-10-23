import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardSummary } from '../api/dashboard.js';
import { formatRupees } from '../utils/money.js';
import { useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import BarChart from '../components/BarChart.jsx';
import CategoryBars from '../components/CategoryBars.jsx';
import StatCard from '../components/StatCard.jsx';
import Icon from '../components/Icon.jsx';

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
}

const TYPE_LABELS = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  loan_payment: 'Loan payment',
  investment_purchase: 'Investment buy',
  investment_sale: 'Investment sell',
  adjustment: 'Adjustment',
};

const QUICK_ACTIONS = [
  { to: '/expenses', label: 'Add Expense', icon: 'expense' },
  { to: '/bank-accounts', label: 'Add Account', icon: 'bank' },
  { to: '/loans', label: 'Record EMI', icon: 'loan' },
  { to: '/investments', label: 'Add Investment', icon: 'investment' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { version } = useDashboardRefresh();
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  if (loading && !summary) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!summary) return null;

  const { totals, accounts, recentTransactions, expenseCategoryBreakdown, dailyExpenseTotals } =
    summary;

  const hasAnyData =
    accounts.length > 0 || recentTransactions.length > 0 || totals.totalBankBalance !== 0;

  const firstName = (user?.name || '').split(' ')[0] || 'there';
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const unrealized = totals.investmentUnrealizedGain;
  const gainsTone = unrealized == null ? 'accent' : unrealized >= 0 ? 'success' : 'danger';
  const gainsValueClass =
    unrealized == null ? '' : unrealized >= 0 ? 'v-success' : 'v-danger';

  return (
    <div>
      {/* Header + quick actions */}
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="page-subtitle">
            {greeting()}, {firstName} · {today}
          </div>
        </div>
        <div className="quick-actions">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-2"
            >
              <Icon name={a.icon} size={15} />
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="Total Bank Balance"
            value={formatRupees(totals.totalBankBalance)}
            icon="wallet"
            tone="primary"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="Today's Expenses"
            value={formatRupees(totals.todayExpenses)}
            icon="expense"
            tone="danger"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="This Month's Expenses"
            value={formatRupees(totals.monthExpenses)}
            icon="expense"
            tone="danger"
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="Outstanding Loan Principal"
            value={formatRupees(totals.outstandingLoanPrincipal)}
            icon="loan"
            tone="warning"
            subtitle={
              totals.activeLoanCount != null
                ? `${totals.activeLoanCount} active · EMI ${formatRupees(totals.totalMonthlyEmi)}/mo` +
                (totals.overduePaymentCount ? ` · ${totals.overduePaymentCount} overdue` : '')
                : undefined
            }
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="Investment Cost Basis"
            value={formatRupees(totals.totalInvestmentCostBasis)}
            icon="investment"
            tone="accent"
            subtitle={
              totals.investmentCurrentValue == null
                ? `Known value: ${formatRupees(totals.investmentKnownValue)}` +
                (totals.investmentHoldingsWithUnknownValue
                  ? ` · ${totals.investmentHoldingsWithUnknownValue} unknown`
                  : '')
                : `Current value: ${formatRupees(totals.investmentCurrentValue)}`
            }
          />
        </div>
        <div className="col-12 col-sm-6 col-xl-4">
          <StatCard
            label="Investment Gains"
            value={unrealized == null ? '—' : formatRupees(unrealized)}
            icon="trend"
            tone={gainsTone}
            valueClass={gainsValueClass}
            subtitle={
              `Realized: ${formatRupees(totals.investmentRealizedGain ?? 0)}` +
              (unrealized == null ? ' · unrealized unknown' : ' unrealized')
            }
          />
        </div>
      </div>

      {!hasAnyData && (
        <EmptyState
          title="Nothing to show yet"
          message="Add a bank account and record an expense to see your dashboard come to life."
          action={
            <Link to="/bank-accounts" className="btn btn-primary">
              + Add Account
            </Link>
          }
        />
      )}

      {/* Charts + breakdown */}
      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="card chart-card h-100">
            <div className="card-body">
              <h2 className="section-title">Recent daily spending</h2>
              <BarChart data={dailyExpenseTotals} ariaLabel="Recent daily spending" />
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-body">
              <h2 className="section-title">This month by category</h2>
              <CategoryBars data={expenseCategoryBreakdown} />
            </div>
          </div>
        </div>

        {/* Account summary */}
        <div className="col-12 col-lg-5">
          <div className="card h-100">
            <div className="card-body">
              <h2 className="section-title">Accounts</h2>
              {accounts.length === 0 ? (
                <p className="text-secondary mb-0">No accounts yet.</p>
              ) : (
                <ul className="list-group list-group-flush">
                  {accounts.map((a) => (
                    <li key={a.id} className="list-group-item d-flex justify-content-between px-0">
                      <span>
                        {a.accountName}{' '}
                        <span className="text-secondary small">({a.bankName})</span>
                      </span>
                      <span className="fw-semibold fin-figure">{formatRupees(a.currentBalance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Recent transactions */}
        <div className="col-12 col-lg-7">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h2 className="section-title mb-0">Recent transactions</h2>
                <Link to="/transactions" className="small">View all</Link>
              </div>
              {recentTransactions.length === 0 ? (
                <p className="text-secondary mb-0">No transactions yet.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <tbody>
                      {recentTransactions.map((t) => (
                        <tr key={t.id} className={t.status === 'reversed' ? 'text-secondary' : ''}>
                          <td className="text-nowrap">{formatDate(t.transactionDate)}</td>
                          <td>
                            {TYPE_LABELS[t.type] || t.type}
                            {t.status === 'reversed' && (
                              <span className="badge text-bg-secondary ms-2">Reversed</span>
                            )}
                            {t.description && (
                              <div className="small text-secondary">{t.description}</div>
                            )}
                          </td>
                          <td className="text-end text-nowrap fin-figure">{formatRupees(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
