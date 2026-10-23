import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BankAccounts from '../pages/BankAccounts.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DashboardRefreshProvider } from '../context/DashboardRefreshContext.jsx';
import * as accountsApi from '../api/accounts.js';

vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  getAccount: vi.fn(),
  getAccountTransactions: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DashboardRefreshProvider>
          <BankAccounts />
        </DashboardRefreshProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('Bank Accounts page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an empty state when there are no accounts', async () => {
    accountsApi.listAccounts.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no bank accounts yet/i)).toBeInTheDocument()
    );
  });

  it('renders the account list with current balances', async () => {
    accountsApi.listAccounts.mockResolvedValue([
      {
        id: 'a1',
        bankName: 'HDFC Bank',
        accountName: 'Salary Account',
        accountType: 'savings',
        currentBalance: 50000,
        isActive: true,
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Salary Account')).toBeInTheDocument());
    expect(screen.getByText('HDFC Bank')).toBeInTheDocument();
    // INR formatted (en-IN uses ₹ and grouping). Appears in the total card and
    // the account card, so there are multiple matches.
    expect(screen.getAllByText(/50,000/).length).toBeGreaterThan(0);
  });

  it('opens the add-account form and validates required fields', async () => {
    accountsApi.listAccounts.mockResolvedValue([]);
    renderPage();
    await waitFor(() => screen.getByText(/no bank accounts yet/i));

    // Use the header toggle button (the empty-state also has one).
    fireEvent.click(screen.getAllByRole('button', { name: /\+ add account/i })[0]);
    // Submit empty -> validation errors; API not called.
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByText(/bank name is required/i)).toBeInTheDocument()
    );
    expect(accountsApi.createAccount).not.toHaveBeenCalled();
  });

  it('creates an account via the API and refreshes the list', async () => {
    accountsApi.listAccounts.mockResolvedValueOnce([]); // initial
    accountsApi.createAccount.mockResolvedValue({ id: 'a1', accountName: 'Salary Account' });
    accountsApi.listAccounts.mockResolvedValueOnce([
      {
        id: 'a1',
        bankName: 'HDFC Bank',
        accountName: 'Salary Account',
        accountType: 'savings',
        currentBalance: 50000,
        isActive: true,
      },
    ]);

    renderPage();
    await waitFor(() => screen.getByText(/no bank accounts yet/i));
    fireEvent.click(screen.getAllByRole('button', { name: /\+ add account/i })[0]);

    fireEvent.change(screen.getByLabelText(/bank name/i), { target: { value: 'HDFC Bank' } });
    fireEvent.change(screen.getByLabelText(/account nickname/i), {
      target: { value: 'Salary Account' },
    });
    fireEvent.change(screen.getByLabelText(/opening balance/i), { target: { value: '50000' } });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(accountsApi.createAccount).toHaveBeenCalledTimes(1));
    expect(accountsApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ bankName: 'HDFC Bank', openingBalance: 50000 })
    );
    await waitFor(() => expect(screen.getByText('Salary Account')).toBeInTheDocument());
  });
});
