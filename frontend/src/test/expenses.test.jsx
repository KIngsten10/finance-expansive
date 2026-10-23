import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Expenses from '../pages/Expenses.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DashboardRefreshProvider } from '../context/DashboardRefreshContext.jsx';
import * as accountsApi from '../api/accounts.js';
import * as expensesApi from '../api/expenses.js';

vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  getAccount: vi.fn(),
  getAccountTransactions: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
}));
vi.mock('../api/expenses.js', () => ({
  listExpenses: vi.fn(),
  getExpense: vi.fn(),
  createExpense: vi.fn(),
  correctExpense: vi.fn(),
  reverseExpense: vi.fn(),
  deleteExpense: vi.fn(),
}));

const ACCOUNTS = [
  { id: 'a1', bankName: 'HDFC', accountName: 'Salary', accountType: 'savings', currentBalance: 1000, isActive: true },
];

function renderPage() {
  return render(
    <ToastProvider>
      <DashboardRefreshProvider>
        <Expenses />
      </DashboardRefreshProvider>
    </ToastProvider>
  );
}

function emptyList() {
  return { expenses: [], pagination: { page: 1, totalPages: 1, totalCount: 0 }, totalMatchingAmount: 0 };
}

describe('Expenses page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsApi.listAccounts.mockResolvedValue(ACCOUNTS);
    expensesApi.listExpenses.mockResolvedValue(emptyList());
  });

  it('renders the add-expense form with the active payment account', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/payment account/i)).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /Salary \(HDFC\)/ })).toBeInTheDocument();
  });

  it('validates required fields and does not call the API', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/amount/i));
    // Amount empty -> validation error.
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }));
    await waitFor(() => expect(screen.getByText(/enter an amount/i)).toBeInTheDocument());
    expect(expensesApi.createExpense).not.toHaveBeenCalled();
  });

  it('submits an expense with an idempotency key and refreshes', async () => {
    expensesApi.createExpense.mockResolvedValue({
      expense: { id: 'e1' },
      account: { id: 'a1', currentBalance: 500 },
    });
    renderPage();
    await waitFor(() => screen.getByLabelText(/amount/i));

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }));

    await waitFor(() => expect(expensesApi.createExpense).toHaveBeenCalledTimes(1));
    const [payload, idemKey] = expensesApi.createExpense.mock.calls[0];
    expect(payload).toMatchObject({ amount: 500, category: 'Food', accountId: 'a1' });
    expect(typeof idemKey).toBe('string');
    expect(idemKey.length).toBeGreaterThan(0);
    // Lists refreshed after the successful submission (reloaded at least once
    // beyond the initial load).
    await waitFor(() =>
      expect(expensesApi.listExpenses.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
  });

  it('displays a backend validation error', async () => {
    const err = new Error('A positive amount is required');
    err.details = [{ field: 'amount', message: 'A positive amount is required' }];
    expensesApi.createExpense.mockRejectedValue(err);

    renderPage();
    await waitFor(() => screen.getByLabelText(/amount/i));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/a positive amount is required/i).length).toBeGreaterThan(0)
    );
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolveCreate;
    expensesApi.createExpense.mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    renderPage();
    await waitFor(() => screen.getByLabelText(/amount/i));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '500' } });

    const btn = screen.getByRole('button', { name: /add expense/i });
    fireEvent.click(btn);
    // Button disabled + shows saving; second click is a no-op.
    expect(btn).toBeDisabled();
    fireEvent.click(btn);

    resolveCreate({ expense: { id: 'e1' }, account: { id: 'a1', currentBalance: 500 } });
    await waitFor(() => expect(expensesApi.createExpense).toHaveBeenCalledTimes(1));
  });

  it('renders expense history rows', async () => {
    expensesApi.listExpenses.mockResolvedValue({
      expenses: [
        {
          id: 'e1',
          amount: 250.5,
          category: 'Food',
          description: 'Lunch',
          expenseDate: '2026-10-23',
          accountName: 'Salary',
          status: 'posted',
        },
      ],
      pagination: { page: 1, totalPages: 1, totalCount: 1 },
      totalMatchingAmount: 250.5,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Lunch')).toBeInTheDocument());
    // "Food" also appears as a <option> in the form/filter; assert it shows up
    // inside the history table as a cell.
    const foodCell = screen
      .getAllByText('Food')
      .find((el) => el.tagName === 'TD');
    expect(foodCell).toBeTruthy();
    expect(screen.getAllByText(/250\.50/).length).toBeGreaterThan(0);
  });
});
