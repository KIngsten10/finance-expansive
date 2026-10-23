import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../pages/Dashboard.jsx';
import { DashboardRefreshProvider, useDashboardRefresh } from '../context/DashboardRefreshContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import * as dashboardApi from '../api/dashboard.js';

vi.mock('../api/dashboard.js', () => ({ getDashboardSummary: vi.fn() }));
// Dashboard now shows a personalized greeting via AuthContext; stub /auth/me.
vi.mock('../api/auth.js', () => ({
  fetchMe: vi.fn().mockResolvedValue({ id: 'u1', name: 'Test User', email: 't@example.com' }),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

const EMPTY_SUMMARY = {
  totals: {
    totalBankBalance: 0,
    todayExpenses: 0,
    monthExpenses: 0,
    outstandingLoanPrincipal: 0,
    totalInvestmentCostBasis: 0,
    investmentCurrentValue: null,
    investmentKnownValue: 0,
    investmentHoldingsWithUnknownValue: 0,
    investmentRealizedGain: 0,
    investmentUnrealizedGain: null,
  },
  accounts: [],
  recentTransactions: [],
  expenseCategoryBreakdown: [],
  dailyExpenseTotals: [],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardRefreshProvider>
          <Dashboard />
        </DashboardRefreshProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Dashboard page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state then renders totals', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      totals: { ...EMPTY_SUMMARY.totals, totalBankBalance: 50000, monthExpenses: 8500 },
      accounts: [
        { id: 'a1', bankName: 'HDFC', accountName: 'Salary', accountType: 'savings', currentBalance: 50000 },
      ],
    });

    renderDashboard();
    expect(screen.getByText(/loading dashboard/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Total Bank Balance")).toBeInTheDocument());
    expect(screen.getAllByText(/50,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8,500/).length).toBeGreaterThan(0);
  });

  it('shows unknown investment valuation as text, not a zero value', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      totals: {
        ...EMPTY_SUMMARY.totals,
        totalInvestmentCostBasis: 1000,
        investmentCurrentValue: null,
        investmentKnownValue: 0,
        investmentHoldingsWithUnknownValue: 2,
      },
    });
    renderDashboard();
    // Unknown holdings are surfaced explicitly (never shown as a zero value).
    await waitFor(() =>
      expect(screen.getByText(/2 unknown/i)).toBeInTheDocument()
    );
  });

  it('renders an error state with retry on failure', async () => {
    dashboardApi.getDashboardSummary.mockRejectedValue(new Error('Server down'));
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/server down/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('refetches when the shared refresh version changes', async () => {
    dashboardApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);

    // A tiny harness that triggers a refresh after mount.
    function Harness() {
      const { requestRefresh } = useDashboardRefresh();
      return (
        <>
          <button onClick={requestRefresh}>trigger</button>
          <Dashboard />
        </>
      );
    }
    const { getByText } = render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardRefreshProvider>
            <Harness />
          </DashboardRefreshProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(dashboardApi.getDashboardSummary).toHaveBeenCalledTimes(1));
    getByText('trigger').click();
    await waitFor(() => expect(dashboardApi.getDashboardSummary).toHaveBeenCalledTimes(2));
  });
});
