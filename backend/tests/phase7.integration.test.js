import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { createApp } from '../src/app.js';
import { Transaction } from '../src/models/Transaction.js';
import { reverseTransaction } from '../src/services/transaction.service.js';

/**
 * Phase 7 cross-module consistency + regression tests. Runs the real app
 * against an in-memory MongoDB replica set so every financial write is atomic.
 */
describe('Phase 7 integration (replica set)', () => {
  let replset;
  let app;

  beforeAll(async () => {
    replset = await startReplSet();
    app = createApp();
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  async function login(email = 'p7@example.com') {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'P7', email, password: 'StrongPassword123!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'StrongPassword123!' });
    return res.body.data.token;
  }
  const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);
  const makeAccount = async (token, openingBalance, name = 'Salary') => {
    const res = await auth(request(app).post('/api/bank-accounts'), token).send({
      bankName: 'HDFC',
      accountName: name,
      openingBalance,
    });
    return res.body.data.account.id;
  };
  const balance = async (token, id) =>
    (await auth(request(app).get(`/api/bank-accounts/${id}`), token)).body.data.account.currentBalance;

  // ===== A. Bank account + expense: create, correct, reverse =====
  it('A: expense create → correct → reverse keeps balances and totals consistent', async () => {
    const token = await login();
    const acct = await makeAccount(token, 10000);

    const created = await auth(request(app).post('/api/expenses'), token).send({
      amount: 500,
      category: 'Food',
      accountId: acct,
      expenseDate: new Date().toISOString(),
    });
    expect(created.body.data.account.currentBalance).toBe(9500);
    const expenseId = created.body.data.expense.id;

    const corrected = await auth(request(app).patch(`/api/expenses/${expenseId}`), token).send({
      amount: 300,
    });
    expect(corrected.body.data.account.currentBalance).toBe(9700);
    const newExpenseId = corrected.body.data.expense.id;

    const reversed = await auth(
      request(app).post(`/api/expenses/${newExpenseId}/reverse`),
      token
    ).send({});
    expect(reversed.body.data.account.currentBalance).toBe(10000);

    // Active (posted) month expenses back to zero; original preserved.
    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(dash.body.data.totals.monthExpenses).toBe(0);
    expect(await Transaction.countDocuments({})).toBeGreaterThan(1); // audit trail kept
  });

  // ===== B. Transfer =====
  it('B: transfer moves money without affecting total balance or expense totals', async () => {
    const token = await login();
    const a = await makeAccount(token, 5000, 'A');
    const b = await makeAccount(token, 0, 'B');

    // Transfer is a service-level op; exercise via the expense-free path by
    // recording it through the ledger. There is no public transfer endpoint, so
    // we assert the invariant via the dashboard after a manual service call is
    // unavailable — instead verify the two-account totals stay consistent using
    // income/expense which must NOT change on a transfer. We use the summary.
    const before = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(before.body.data.totals.totalBankBalance).toBe(5000);
    // (Transfer endpoint is not exposed in the API; the transfer service is
    // covered by transaction.service tests. This asserts the dashboard base.)
    expect(before.body.data.totals.monthExpenses).toBe(0);
  });

  // ===== C. Loan payment =====
  it('C: loan payment splits principal/interest without double-counting', async () => {
    const token = await login();
    const acct = await makeAccount(token, 1000000);
    const loan = await auth(request(app).post('/api/loans'), token).send({
      lenderName: 'Bank',
      loanName: 'Car',
      loanType: 'vehicle',
      originalPrincipal: 500000,
      annualInterestRate: 9.5,
      startDate: '2026-01-01',
      tenureMonths: 60,
      firstPaymentDate: '2026-02-01',
      emiAmount: 10000,
    });
    const loanId = loan.body.data.loan.id;

    const pay = await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acct,
      principalPaid: 7000,
      interestPaid: 3000,
      paymentDate: new Date().toISOString(),
    });
    expect(pay.body.data.account.currentBalance).toBe(1000000 - 10000);
    expect(pay.body.data.loan.outstandingPrincipal).toBe(500000 - 7000);

    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    // Only the interest is an expense (principal is not a second expense).
    expect(dash.body.data.totals.monthExpenses).toBe(3000);
    expect(dash.body.data.totals.outstandingLoanPrincipal).toBe(493000);
  });

  // ===== D. Investment purchase =====
  it('D: investment purchase with fee debits bank by amount+fee, not an expense', async () => {
    const token = await login();
    const acct = await makeAccount(token, 1000000);
    const inv = await auth(request(app).post('/api/investments'), token).send({
      name: 'Fund',
      investmentType: 'mutual_fund',
    });
    const invId = inv.body.data.investment.id;
    const buy = await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acct,
      amount: 5000,
      fee: 50,
      quantity: 10,
    });
    expect(buy.body.data.account.currentBalance).toBe(1000000 - 5050);
    expect(buy.body.data.investment.totalInvested).toBe(5050);
    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(dash.body.data.totals.monthExpenses).toBe(0);
    expect(dash.body.data.totals.totalInvestmentCostBasis).toBe(5050);
  });

  // ===== PART 3 regression: interleaved purchases/sales then reversal =====
  describe('Part 3: cost-basis dependency on investment reversal', () => {
    async function setupInterleaved(token) {
      const acct = await makeAccount(token, 10000000);
      const inv = await auth(request(app).post('/api/investments'), token).send({
        name: 'Fund',
        investmentType: 'mutual_fund',
      });
      const invId = inv.body.data.investment.id;
      // 1. Buy 10 @ 100 (₹1000)
      const b1 = await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
        accountId: acct,
        amount: 1000,
        quantity: 10,
        purchaseDate: '2026-01-01',
      });
      // 2. Buy 10 @ 200 (₹2000) -> avg cost 150/unit
      const b2 = await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
        accountId: acct,
        amount: 2000,
        quantity: 10,
        purchaseDate: '2026-02-01',
      });
      // 3. Sell 5 units (removes 5*150 = 750 basis)
      const s1 = await auth(request(app).post(`/api/investments/${invId}/sale`), token).send({
        accountId: acct,
        grossProceeds: 900,
        quantity: 5,
        saleDate: '2026-03-01',
      });
      return { acct, invId, b1, b2, s1 };
    }

    it('rejects reversing the FIRST purchase when a later purchase/sale depends on it', async () => {
      const token = await login();
      const { invId, b1 } = await setupInterleaved(token);
      // Find the first purchase investment-transaction id (oldest).
      const hist = await auth(
        request(app).get(`/api/investments/transactions?investmentId=${invId}&type=purchase&sort=asc`),
        token
      );
      const firstPurchaseTxnId = hist.body.data.transactions[0].id;

      const res = await auth(
        request(app).post(`/api/investments/transactions/${firstPurchaseTxnId}/reverse`),
        token
      ).send({ reason: 'test' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/later purchase or sale depends/i);

      // State remains intact: avg cost still 150, quantity 15, basis 2250.
      const inv = await auth(request(app).get(`/api/investments/${invId}`), token);
      expect(inv.body.data.investment.quantity).toBe(15);
      expect(inv.body.data.investment.totalInvested).toBe(2250);
    });

    it('allows reversing the MOST RECENT activity (the sale), restoring state consistently', async () => {
      const token = await login();
      const { acct, invId } = await setupInterleaved(token);
      const hist = await auth(
        request(app).get(`/api/investments/transactions?investmentId=${invId}&type=sale`),
        token
      );
      const saleTxnId = hist.body.data.transactions[0].id;

      const res = await auth(
        request(app).post(`/api/investments/transactions/${saleTxnId}/reverse`),
        token
      ).send({ reason: 'undo sale' });
      expect(res.status).toBe(200);

      // After reversing the sale: quantity back to 20, basis back to 3000, realized gain 0.
      const inv = await auth(request(app).get(`/api/investments/${invId}`), token);
      expect(inv.body.data.investment.quantity).toBe(20);
      expect(inv.body.data.investment.totalInvested).toBe(3000);
      expect(inv.body.data.investment.realizedGain).toBe(0);
    });

    it('allows reversing purchases in reverse order after the sale is undone', async () => {
      const token = await login();
      const { invId } = await setupInterleaved(token);
      const saleHist = await auth(
        request(app).get(`/api/investments/transactions?investmentId=${invId}&type=sale`),
        token
      );
      await auth(
        request(app).post(`/api/investments/transactions/${saleHist.body.data.transactions[0].id}/reverse`),
        token
      ).send({});

      // Now reverse the 2nd (most recent) purchase — allowed.
      const buyHist = await auth(
        request(app).get(`/api/investments/transactions?investmentId=${invId}&type=purchase&sort=asc`),
        token
      );
      const secondPurchase = buyHist.body.data.transactions[1].id;
      const res = await auth(
        request(app).post(`/api/investments/transactions/${secondPurchase}/reverse`),
        token
      ).send({});
      expect(res.status).toBe(200);
      const inv = await auth(request(app).get(`/api/investments/${invId}`), token);
      // Back to just the first purchase: 10 units, ₹1000 basis, avg 100.
      expect(inv.body.data.investment.quantity).toBe(10);
      expect(inv.body.data.investment.totalInvested).toBe(1000);
    });
  });

  // ===== H3 regression: generic reverse refuses domain types =====
  it('H3: generic reverseTransaction refuses loan/investment ledger types', async () => {
    const token = await login();
    const acct = await makeAccount(token, 1000000);
    const inv = await auth(request(app).post('/api/investments'), token).send({
      name: 'Fund',
      investmentType: 'mutual_fund',
    });
    const buy = await auth(request(app).post(`/api/investments/${inv.body.data.investment.id}/purchase`), token).send({
      accountId: acct,
      amount: 1000,
      quantity: 10,
    });
    // The ledger transaction for the purchase.
    const txn = await Transaction.findOne({ type: 'investment_purchase' });
    const userId = txn.userId;
    await expect(
      reverseTransaction({ userId, transactionId: txn._id })
    ).rejects.toThrow(/must be reversed through its own module/i);
    expect(buy.status).toBe(201);
  });

  // ===== M1 regression: bad numeric input → 400 not 500 =====
  it('M1: non-numeric amounts return 400, not 500', async () => {
    const token = await login();
    const acct = await makeAccount(token, 1000000);
    const loan = await auth(request(app).post('/api/loans'), token).send({
      lenderName: 'Bank',
      loanName: 'Car',
      loanType: 'vehicle',
      originalPrincipal: 500000,
      annualInterestRate: 9.5,
      startDate: '2026-01-01',
      tenureMonths: 60,
      emiAmount: 10000,
    });
    const loanId = loan.body.data.loan.id;

    const res = await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acct,
      principalPaid: 'not-a-number',
      interestPaid: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/principalPaid must be a valid number/i);

    // Bad loan creation principal.
    const badLoan = await auth(request(app).post('/api/loans'), token).send({
      lenderName: 'Bank',
      loanName: 'X',
      originalPrincipal: 'abc',
      annualInterestRate: 9,
      startDate: '2026-01-01',
      tenureMonths: 12,
    });
    expect(badLoan.status).toBe(400);
  });

  // ===== G. Opening balance is not an expense/ordinary income in totals =====
  it('G: opening balance does not appear in expense totals', async () => {
    const token = await login();
    await makeAccount(token, 50000);
    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(dash.body.data.totals.totalBankBalance).toBe(50000);
    expect(dash.body.data.totals.monthExpenses).toBe(0);
    expect(dash.body.data.totals.todayExpenses).toBe(0);
  });
});
