import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DashboardRefreshProvider } from '../context/DashboardRefreshContext.jsx';
import * as authApi from '../api/auth.js';

// Mock the auth API so tests are hermetic (no backend/network).
vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchMe: vi.fn(),
}));

// Pages fetch financial data on mount; stub those modules so no network occurs.
vi.mock('../api/dashboard.js', () => ({
  getDashboardSummary: vi.fn().mockResolvedValue({
    totals: {
      totalBankBalance: 0,
      todayExpenses: 0,
      monthExpenses: 0,
      outstandingLoanPrincipal: 0,
      totalInvestmentCostBasis: 0,
      investmentCurrentValue: null,
      investmentHoldingsWithUnknownValue: 0,
    },
    accounts: [],
    recentTransactions: [],
    expenseCategoryBreakdown: [],
    dailyExpenseTotals: [],
  }),
}));
vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn().mockResolvedValue([]),
  createAccount: vi.fn(),
  getAccount: vi.fn(),
  getAccountTransactions: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
}));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <DashboardRefreshProvider>
              <App />
            </DashboardRefreshProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('protected frontend routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('redirects an unauthenticated user from a protected route to the login page', async () => {
    // No valid session cookie -> /auth/me rejects -> unauthenticated.
    authApi.fetchMe.mockRejectedValue(new Error('Authentication required'));
    renderAt('/dashboard');

    await waitFor(() => {
      expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
    });
    // The sidebar (authenticated shell) must not be present.
    expect(screen.queryByText(/log out/i)).not.toBeInTheDocument();
  });

  it('shows the login page directly at /login when unauthenticated', async () => {
    authApi.fetchMe.mockRejectedValue(new Error('Authentication required'));
    renderAt('/login');
    await waitFor(() => {
      expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
    });
  });

  it('redirects an authenticated user away from /login to the dashboard', async () => {
    // A valid session cookie -> /auth/me resolves with the profile.
    authApi.fetchMe.mockResolvedValue({
      id: 'u1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      currency: 'INR',
      isActive: true,
    });

    renderAt('/login');

    // Dashboard shell renders the user's name in the sidebar and a logout button.
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('renders a protected page for an authenticated user', async () => {
    authApi.fetchMe.mockResolvedValue({
      id: 'u1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      currency: 'INR',
      isActive: true,
    });

    renderAt('/bank-accounts');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /bank accounts/i })).toBeInTheDocument();
    });
  });
});
