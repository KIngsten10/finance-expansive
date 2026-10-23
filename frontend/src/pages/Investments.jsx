import { useCallback, useEffect, useState } from 'react';
import {
  listInvestments,
  getPortfolioSummary,
} from '../api/investments.js';
import { formatRupees } from '../utils/money.js';
import { useToast } from '../context/ToastContext.jsx';
import { useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import Spinner from '../components/Spinner.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AddInvestmentForm, { INVESTMENT_TYPES } from '../components/AddInvestmentForm.jsx';
import InvestmentOpModal from '../components/InvestmentOpModal.jsx';

const TYPE_LABEL = Object.fromEntries(INVESTMENT_TYPES.map((t) => [t.value, t.label]));

function SummaryCard({ title, value, accent = 'primary', subtitle }) {
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

function gainAccent(v) {
  if (v == null) return 'secondary';
  return v >= 0 ? 'success' : 'danger';
}

export default function Investments() {
  const [investments, setInvestments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [op, setOp] = useState(null); // { op, investment }
  const toast = useToast();
  const { requestRefresh } = useDashboardRefresh();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listData, summaryData] = await Promise.all([
        listInvestments({ limit: 100 }),
        getPortfolioSummary(),
      ]);
      setInvestments(listData.investments);
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
    toast.success('Investment created');
    load();
    requestRefresh();
  }

  function handleOpDone() {
    const label = op?.op;
    setOp(null);
    toast.success('Saved');
    load();
    requestRefresh();
    return label;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Investments</h1>
          <div className="page-subtitle">Track your portfolio, cost basis, and gains</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : '+ Add Investment'}
        </button>
      </div>

      {summary && !loading && !error && (
        <>
          {!summary.valuationComplete && summary.holdingsWithUnknownValue > 0 && (
            <div className="alert alert-warning py-2" role="alert">
              {summary.holdingsWithUnknownValue} investment(s) have no current valuation. The known
              current value below is a partial total, not the full portfolio value.
            </div>
          )}
          <div className="row g-3 mb-4">
            <SummaryCard title="Total Cost Basis" value={formatRupees(summary.totalCostBasis)} />
            <SummaryCard
              title="Known Current Value"
              value={formatRupees(summary.knownCurrentValue)}
              subtitle={summary.valuationComplete ? 'All holdings valued' : 'Partial (some unknown)'}
            />
            <SummaryCard
              title="Unrealized Gain / Loss"
              value={summary.unrealizedGain == null ? '—' : formatRupees(summary.unrealizedGain)}
              accent={gainAccent(summary.unrealizedGain)}
              subtitle={summary.unrealizedGain == null ? 'No valued holdings' : undefined}
            />
            <SummaryCard
              title="Realized Gain / Loss"
              value={formatRupees(summary.realizedGain)}
              accent={gainAccent(summary.realizedGain)}
            />
          </div>
        </>
      )}

      {showForm && (
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <h2 className="h6 mb-3">Add an investment</h2>
            <AddInvestmentForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
          </div>
        </div>
      )}

      {loading && <Spinner label="Loading investments…" />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && investments.length === 0 && (
        <EmptyState
          title="No investments yet"
          message="Add an investment profile, then record a purchase to start tracking your portfolio."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Investment
            </button>
          }
        />
      )}

      {!loading && !error && investments.length > 0 && (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Provider</th>
                  <th className="text-end">Quantity</th>
                  <th className="text-end">Cost Basis</th>
                  <th className="text-end">Current Value</th>
                  <th className="text-end">Unrealized</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {investments.map((inv) => {
                  const unrealized =
                    inv.currentValue != null ? inv.currentValue - inv.totalInvested : null;
                  return (
                    <tr key={inv.id}>
                      <td>{inv.name}</td>
                      <td>{TYPE_LABEL[inv.investmentType] || inv.investmentType}</td>
                      <td>{inv.providerName || '—'}</td>
                      <td className="text-end">{inv.quantity ?? '—'}</td>
                      <td className="text-end">{formatRupees(inv.totalInvested)}</td>
                      <td className="text-end">
                        {inv.currentValue == null ? (
                          <span className="text-muted">Unknown</span>
                        ) : (
                          formatRupees(inv.currentValue)
                        )}
                      </td>
                      <td className={`text-end text-${gainAccent(unrealized)}`}>
                        {unrealized == null ? '—' : formatRupees(unrealized)}
                      </td>
                      <td>
                        <span
                          className={`badge ${inv.status === 'open' ? 'text-bg-success' : 'text-bg-secondary'
                            }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm">
                          <button
                            type="button"
                            className="btn btn-outline-primary"
                            onClick={() => setOp({ op: 'purchase', investment: inv })}
                          >
                            Buy
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-primary"
                            onClick={() => setOp({ op: 'sale', investment: inv })}
                          >
                            Sell
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setOp({ op: 'income', investment: inv })}
                          >
                            Income
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setOp({ op: 'valuation', investment: inv })}
                          >
                            Value
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {op && (
        <InvestmentOpModal
          op={op.op}
          investment={op.investment}
          onDone={handleOpDone}
          onCancel={() => setOp(null)}
        />
      )}
    </div>
  );
}
