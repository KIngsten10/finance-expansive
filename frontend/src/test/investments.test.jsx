import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Investments from '../pages/Investments.jsx';
import AddInvestmentForm from '../components/AddInvestmentForm.jsx';
import InvestmentOpModal from '../components/InvestmentOpModal.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DashboardRefreshProvider } from '../context/DashboardRefreshContext.jsx';
import * as investmentsApi from '../api/investments.js';
import * as accountsApi from '../api/accounts.js';

vi.mock('../api/investments.js', () => ({
  listInvestments: vi.fn(),
  getInvestment: vi.fn(),
  createInvestment: vi.fn(),
  updateInvestment: vi.fn(),
  getPortfolioSummary: vi.fn(),
  listInvestmentTransactions: vi.fn(),
  recordPurchase: vi.fn(),
  recordSale: vi.fn(),
  recordIncome: vi.fn(),
  recordFee: vi.fn(),
  updateValuation: vi.fn(),
  reverseInvestmentTransaction: vi.fn(),
}));
vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  getAccount: vi.fn(),
  getAccountTransactions: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
}));

const SUMMARY_COMPLETE = {
  totalCostBasis: 30000,
  knownCurrentValue: 32000,
  valuationComplete: true,
  holdingsWithKnownValue: 1,
  holdingsWithUnknownValue: 0,
  unrealizedGain: 2000,
  realizedGain: 500,
  totalIncome: 0,
  totalFees: 0,
  investmentCount: 1,
  allocationByType: [],
};
const INV = {
  id: 'i1',
  name: 'Example Fund',
  investmentType: 'mutual_fund',
  providerName: 'Example AMC',
  quantity: 10,
  totalInvested: 30000,
  currentValue: 32000,
  realizedGain: 500,
  status: 'open',
};

function renderPage() {
  return render(
    <ToastProvider>
      <DashboardRefreshProvider>
        <Investments />
      </DashboardRefreshProvider>
    </ToastProvider>
  );
}

describe('Investments page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsApi.listAccounts.mockResolvedValue([
      { id: 'a1', bankName: 'HDFC', accountName: 'Salary', currentBalance: 1000000, isActive: true },
    ]);
  });

  it('renders loading then an empty state', async () => {
    investmentsApi.listInvestments.mockResolvedValue({ investments: [], pagination: {} });
    investmentsApi.getPortfolioSummary.mockResolvedValue({
      ...SUMMARY_COMPLETE,
      totalCostBasis: 0,
      knownCurrentValue: 0,
      unrealizedGain: null,
      realizedGain: 0,
      investmentCount: 0,
    });
    renderPage();
    expect(screen.getByText(/loading investments/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/no investments yet/i)).toBeInTheDocument());
  });

  it('renders the summary and investment list', async () => {
    investmentsApi.listInvestments.mockResolvedValue({ investments: [INV], pagination: {} });
    investmentsApi.getPortfolioSummary.mockResolvedValue(SUMMARY_COMPLETE);
    renderPage();
    await waitFor(() => expect(screen.getByText('Example Fund')).toBeInTheDocument());
    expect(screen.getByText(/total cost basis/i)).toBeInTheDocument();
    // "Realized Gain / Loss" card title (also appears in "Unrealized …").
    expect(screen.getByText(/^Realized Gain \/ Loss$/i)).toBeInTheDocument();
  });

  it('shows a valuation completeness warning when some values are unknown', async () => {
    investmentsApi.listInvestments.mockResolvedValue({ investments: [INV], pagination: {} });
    investmentsApi.getPortfolioSummary.mockResolvedValue({
      ...SUMMARY_COMPLETE,
      valuationComplete: false,
      holdingsWithUnknownValue: 2,
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/have no current valuation/i)).toBeInTheDocument()
    );
  });

  it('shows an error state with retry', async () => {
    investmentsApi.listInvestments.mockRejectedValue(new Error('Server down'));
    investmentsApi.getPortfolioSummary.mockRejectedValue(new Error('Server down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/server down/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('AddInvestmentForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the required name', async () => {
    render(
      <ToastProvider>
        <AddInvestmentForm onCreated={vi.fn()} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /save investment/i }));
    await waitFor(() =>
      expect(screen.getByText(/investment name is required/i)).toBeInTheDocument()
    );
    expect(investmentsApi.createInvestment).not.toHaveBeenCalled();
  });

  it('creates an investment profile', async () => {
    investmentsApi.createInvestment.mockResolvedValue({ id: 'i1' });
    const onCreated = vi.fn();
    render(
      <ToastProvider>
        <AddInvestmentForm onCreated={onCreated} />
      </ToastProvider>
    );
    fireEvent.change(screen.getByLabelText(/investment name/i), {
      target: { value: 'Example Fund' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save investment/i }));
    await waitFor(() => expect(investmentsApi.createInvestment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});

describe('InvestmentOpModal (purchase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsApi.listAccounts.mockResolvedValue([
      { id: 'a1', bankName: 'HDFC', accountName: 'Salary', currentBalance: 1000000, isActive: true },
    ]);
  });

  it('loads accounts into the purchase form', async () => {
    render(<InvestmentOpModal op="purchase" investment={INV} onDone={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Salary \(HDFC\)/ })).toBeInTheDocument()
    );
  });

  it('submits a purchase with an idempotency key and prevents double submit', async () => {
    let resolveFn;
    investmentsApi.recordPurchase.mockImplementation(
      () => new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    const onDone = vi.fn();
    render(<InvestmentOpModal op="purchase" investment={INV} onDone={onDone} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByLabelText(/amount/i));
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '10' } });

    const btn = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    fireEvent.click(btn);

    resolveFn({ investment: INV, account: { currentBalance: 997000 } });
    await waitFor(() => expect(investmentsApi.recordPurchase).toHaveBeenCalledTimes(1));
    const [id, payload, idemKey] = investmentsApi.recordPurchase.mock.calls[0];
    expect(id).toBe('i1');
    expect(payload).toMatchObject({ accountId: 'a1', amount: 3000, quantity: 10 });
    expect(typeof idemKey).toBe('string');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('displays a backend error', async () => {
    investmentsApi.recordPurchase.mockRejectedValue(
      new Error('Insufficient funds in the selected account')
    );
    render(<InvestmentOpModal op="purchase" investment={INV} onDone={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => screen.getByLabelText(/^amount/i));
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '9999999' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/insufficient funds/i)).toBeInTheDocument());
  });

  it('records a valuation (no account needed)', async () => {
    investmentsApi.updateValuation.mockResolvedValue({ ...INV, currentValue: 35000 });
    const onDone = vi.fn();
    render(<InvestmentOpModal op="valuation" investment={INV} onDone={onDone} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/current value/i), { target: { value: '35000' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(investmentsApi.updateValuation).toHaveBeenCalledTimes(1));
    const [id, payload] = investmentsApi.updateValuation.mock.calls[0];
    expect(id).toBe('i1');
    expect(payload).toMatchObject({ currentValue: 35000 });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
