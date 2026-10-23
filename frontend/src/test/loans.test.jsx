import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Loans from '../pages/Loans.jsx';
import AddLoanForm from '../components/AddLoanForm.jsx';
import RecordLoanPaymentForm from '../components/RecordLoanPaymentForm.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DashboardRefreshProvider } from '../context/DashboardRefreshContext.jsx';
import * as loansApi from '../api/loans.js';
import * as accountsApi from '../api/accounts.js';

vi.mock('../api/loans.js', () => ({
  listLoans: vi.fn(),
  getLoan: vi.fn(),
  createLoan: vi.fn(),
  updateLoan: vi.fn(),
  calculateEmi: vi.fn(),
  getLoanSchedule: vi.fn(),
  getLoanSummary: vi.fn(),
  getUpcomingPayments: vi.fn(),
  listLoanPayments: vi.fn(),
  recordLoanPayment: vi.fn(),
  reverseLoanPayment: vi.fn(),
  adjustLoan: vi.fn(),
  closeLoan: vi.fn(),
}));
vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  getAccount: vi.fn(),
  getAccountTransactions: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
}));

const SUMMARY = {
  totalOutstandingPrincipal: 500000,
  totalMonthlyEmi: 10502,
  activeLoanCount: 1,
  overduePaymentCount: 0,
  upcomingPaymentCount: 1,
};
const LOAN = {
  id: 'l1',
  lenderName: 'Example Bank',
  loanName: 'Car Loan',
  loanType: 'vehicle',
  originalPrincipal: 500000,
  outstandingPrincipal: 500000,
  annualInterestRate: 9.5,
  emiAmount: 10502,
  nextPaymentDate: '2026-02-01',
  status: 'active',
};

function renderLoans() {
  return render(
    <ToastProvider>
      <DashboardRefreshProvider>
        <Loans />
      </DashboardRefreshProvider>
    </ToastProvider>
  );
}

describe('Loans page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsApi.listAccounts.mockResolvedValue([
      { id: 'a1', bankName: 'HDFC', accountName: 'Salary', currentBalance: 1000000, isActive: true },
    ]);
  });

  it('shows a loading state then an empty state', async () => {
    loansApi.listLoans.mockResolvedValue({ loans: [], pagination: {} });
    loansApi.getLoanSummary.mockResolvedValue({ ...SUMMARY, activeLoanCount: 0, totalOutstandingPrincipal: 0, totalMonthlyEmi: 0 });
    renderLoans();
    expect(screen.getByText(/loading loans/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/no loans yet/i)).toBeInTheDocument());
  });

  it('renders summary cards and the loans table', async () => {
    loansApi.listLoans.mockResolvedValue({ loans: [LOAN], pagination: {} });
    loansApi.getLoanSummary.mockResolvedValue(SUMMARY);
    renderLoans();
    await waitFor(() => expect(screen.getByText('Car Loan')).toBeInTheDocument());
    expect(screen.getByText('Example Bank')).toBeInTheDocument();
    expect(screen.getByText(/total outstanding/i)).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    loansApi.listLoans.mockRejectedValue(new Error('Server down'));
    loansApi.getLoanSummary.mockRejectedValue(new Error('Server down'));
    renderLoans();
    await waitFor(() => expect(screen.getByText(/server down/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('AddLoanForm', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderForm(onCreated = vi.fn()) {
    return render(
      <ToastProvider>
        <AddLoanForm onCreated={onCreated} />
      </ToastProvider>
    );
  }

  it('validates required fields', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /save loan/i }));
    await waitFor(() => expect(screen.getByText(/lender name is required/i)).toBeInTheDocument());
    expect(loansApi.createLoan).not.toHaveBeenCalled();
  });

  it('calculates and displays an estimated EMI', async () => {
    loansApi.calculateEmi.mockResolvedValue({
      estimatedEmi: 10500.93,
      totalRepayment: 630055.8,
      totalInterest: 130055.8,
      assumptions: [],
    });
    renderForm();
    fireEvent.change(screen.getByLabelText(/original principal/i), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(/annual interest rate/i), { target: { value: '9.5' } });
    fireEvent.change(screen.getByLabelText(/tenure/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate emi/i }));

    await waitFor(() =>
      expect(loansApi.calculateEmi).toHaveBeenCalledWith({
        principal: 500000,
        annualInterestRate: 9.5,
        tenureMonths: 60,
      })
    );
    await waitFor(() => expect(screen.getByText(/estimated emi/i)).toBeInTheDocument());
  });

  it('creates a loan via the API', async () => {
    loansApi.createLoan.mockResolvedValue({ id: 'l1' });
    const onCreated = vi.fn();
    renderForm(onCreated);

    fireEvent.change(screen.getByLabelText(/lender name/i), { target: { value: 'Example Bank' } });
    fireEvent.change(screen.getByLabelText(/loan name/i), { target: { value: 'Car Loan' } });
    fireEvent.change(screen.getByLabelText(/original principal/i), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(/annual interest rate/i), { target: { value: '9.5' } });
    fireEvent.change(screen.getByLabelText(/tenure/i), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-01-01' } });

    fireEvent.click(screen.getByRole('button', { name: /save loan/i }));
    await waitFor(() => expect(loansApi.createLoan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});

describe('RecordLoanPaymentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsApi.listAccounts.mockResolvedValue([
      { id: 'a1', bankName: 'HDFC', accountName: 'Salary', currentBalance: 1000000, isActive: true },
    ]);
  });

  function renderForm(onRecorded = vi.fn()) {
    return render(<RecordLoanPaymentForm loan={LOAN} onRecorded={onRecorded} />);
  }

  it('loads active accounts into the form', async () => {
    renderForm();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Salary \(HDFC\)/ })).toBeInTheDocument()
    );
  });

  it('shows the live total of principal + interest', async () => {
    renderForm();
    await waitFor(() => screen.getByLabelText(/principal component/i));
    fireEvent.change(screen.getByLabelText(/principal component/i), { target: { value: '6380' } });
    fireEvent.change(screen.getByLabelText(/interest component/i), { target: { value: '4000' } });
    await waitFor(() => expect(screen.getByText(/10,380/)).toBeInTheDocument());
  });

  it('submits a payment with an idempotency key and prevents double submit', async () => {
    let resolveFn;
    loansApi.recordLoanPayment.mockImplementation(
      () => new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    const onRecorded = vi.fn();
    renderForm(onRecorded);
    await waitFor(() => screen.getByLabelText(/principal component/i));

    fireEvent.change(screen.getByLabelText(/principal component/i), { target: { value: '6380' } });
    fireEvent.change(screen.getByLabelText(/interest component/i), { target: { value: '4000' } });

    const btn = screen.getByRole('button', { name: /record payment/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    fireEvent.click(btn); // ignored

    resolveFn({ payment: { id: 'p1' }, loan: LOAN, account: { currentBalance: 989620 } });
    await waitFor(() => expect(loansApi.recordLoanPayment).toHaveBeenCalledTimes(1));

    const [loanId, payload, idemKey] = loansApi.recordLoanPayment.mock.calls[0];
    expect(loanId).toBe('l1');
    expect(payload).toMatchObject({ principalPaid: 6380, interestPaid: 4000, accountId: 'a1' });
    expect(typeof idemKey).toBe('string');
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  });

  it('displays a backend error', async () => {
    loansApi.recordLoanPayment.mockRejectedValue(new Error('Insufficient funds in the selected account'));
    renderForm();
    await waitFor(() => screen.getByLabelText(/principal component/i));
    fireEvent.change(screen.getByLabelText(/principal component/i), { target: { value: '6380' } });
    fireEvent.change(screen.getByLabelText(/interest component/i), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));
    await waitFor(() =>
      expect(screen.getByText(/insufficient funds/i)).toBeInTheDocument()
    );
  });
});
