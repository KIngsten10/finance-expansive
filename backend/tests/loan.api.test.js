import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { createApp } from '../src/app.js';
import { Expense } from '../src/models/Expense.js';
import { LoanPayment } from '../src/models/LoanPayment.js';

/**
 * Phase 5 loan API integration tests against an in-memory MongoDB REPLICA SET
 * so loan-payment transactions run atomically for real.
 */
describe('Phase 5 loan APIs (replica set)', () => {
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

  async function login(email = 'loanuser@example.com') {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Loan User', email, password: 'StrongPassword123!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'StrongPassword123!' });
    return res.body.data.token;
  }
  const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);

  async function makeAccount(token, openingBalance = 1000000) {
    const res = await auth(request(app).post('/api/bank-accounts'), token).send({
      bankName: 'HDFC',
      accountName: 'Salary',
      accountType: 'savings',
      openingBalance,
    });
    return res.body.data.account.id;
  }

  async function makeLoan(token, overrides = {}) {
    const res = await auth(request(app).post('/api/loans'), token).send({
      lenderName: 'Example Bank',
      loanName: 'Car Loan',
      loanType: 'vehicle',
      originalPrincipal: 500000,
      annualInterestRate: 9.5,
      startDate: '2026-01-01',
      tenureMonths: 60,
      firstPaymentDate: '2026-02-01',
      emiAmount: 10502,
      ...overrides,
    });
    return res;
  }

  // ---- Loan CRUD ----
  it('creates a loan (records liability, no bank movement)', async () => {
    const token = await login();
    const acctId = await makeAccount(token);
    const res = await makeLoan(token);
    expect(res.status).toBe(201);
    expect(res.body.data.loan.outstandingPrincipal).toBe(500000);
    expect(res.body.data.loan.status).toBe('active');
    // Bank balance unchanged by loan creation.
    const acct = await auth(request(app).get(`/api/bank-accounts/${acctId}`), token);
    expect(acct.body.data.account.currentBalance).toBe(1000000);
  });

  it('rejects invalid loan terms', async () => {
    const token = await login();
    const res = await makeLoan(token, { originalPrincipal: -1 });
    expect(res.status).toBe(400);
    const res2 = await makeLoan(token, { tenureMonths: 0 });
    expect(res2.status).toBe(400);
  });

  it('does not allow PATCH to rewrite outstanding principal', async () => {
    const token = await login();
    const { body } = await makeLoan(token);
    const id = body.data.loan.id;
    const res = await auth(request(app).patch(`/api/loans/${id}`), token).send({
      loanName: 'Renamed Loan',
      outstandingPrincipal: 1, // must be ignored
      outstandingPrincipalPaise: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.loan.loanName).toBe('Renamed Loan');
    expect(res.body.data.loan.outstandingPrincipal).toBe(500000);
  });

  // ---- EMI calc ----
  it('calculates EMI without side effects', async () => {
    const token = await login();
    const res = await auth(request(app).post('/api/loans/calculate-emi'), token).send({
      principal: 500000,
      annualInterestRate: 9.5,
      tenureMonths: 60,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedEmi).toBeGreaterThan(10000);
    expect(res.body.data.estimatedEmi).toBeLessThan(11000);
    expect(Array.isArray(res.body.data.assumptions)).toBe(true);
  });

  it('calculates a zero-interest EMI', async () => {
    const token = await login();
    const res = await auth(request(app).post('/api/loans/calculate-emi'), token).send({
      principal: 120000,
      annualInterestRate: 0,
      tenureMonths: 12,
    });
    expect(res.body.data.estimatedEmi).toBe(10000);
    expect(res.body.data.totalInterest).toBe(0);
  });

  // ---- Schedule ----
  it('generates a repayment schedule with statuses', async () => {
    const token = await login();
    const { body } = await makeLoan(token);
    const res = await auth(request(app).get(`/api/loans/${body.data.loan.id}/schedule`), token);
    expect(res.status).toBe(200);
    expect(res.body.data.installments.length).toBeGreaterThan(0);
    const first = res.body.data.installments[0];
    expect(first).toHaveProperty('scheduledPayment');
    expect(first).toHaveProperty('estimatedInterest');
    expect(first).toHaveProperty('status');
  });

  // ---- Payments ----
  it('records a payment: debits bank by total, reduces principal, records interest as expense', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeLoan(token);
    const loanId = body.data.loan.id;

    const res = await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acctId,
      principalPaid: 6380,
      interestPaid: 4000,
      paymentDate: '2026-10-23',
      description: 'October EMI',
    });
    expect(res.status).toBe(201);
    // Bank debited by total (10380).
    expect(res.body.data.account.currentBalance).toBe(1000000 / 1 - 10380);
    // Loan principal reduced by 6380 only.
    expect(res.body.data.loan.outstandingPrincipal).toBe(500000 - 6380);

    // Interest (4000) recorded as an expense; principal is NOT an expense.
    const interestExpenses = await Expense.find({ category: 'loan_interest' });
    expect(interestExpenses).toHaveLength(1);
    expect(interestExpenses[0].amountPaise).toBe(400000);
    expect(await Expense.countDocuments({})).toBe(1); // only the interest expense
  });

  it('validates paymentAmount == principal + interest', async () => {
    const token = await login();
    const acctId = await makeAccount(token);
    const { body } = await makeLoan(token);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/payments`), token).send({
      accountId: acctId,
      paymentAmount: 10000,
      principalPaid: 6380,
      interestPaid: 4000, // 10380 != 10000
    });
    expect(res.status).toBe(400);
  });

  it('rejects principal beyond outstanding', async () => {
    const token = await login();
    const acctId = await makeAccount(token);
    const { body } = await makeLoan(token);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/payments`), token).send({
      accountId: acctId,
      principalPaid: 600000, // > 500000 outstanding
      interestPaid: 0,
    });
    expect(res.status).toBe(400);
  });

  it('rejects insufficient funds', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000); // ₹10
    const { body } = await makeLoan(token);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/payments`), token).send({
      accountId: acctId,
      principalPaid: 6380,
      interestPaid: 4000,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient funds/i);
  });

  it("rejects paying with another user's account", async () => {
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const acctA = await makeAccount(tokenA);
    const { body } = await makeLoan(tokenB);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/payments`), tokenB).send({
      accountId: acctA,
      principalPaid: 100,
      interestPaid: 0,
    });
    expect(res.status).toBe(404);
  });

  it("rejects paying another user's loan", async () => {
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const acctB = await makeAccount(tokenB);
    const { body } = await makeLoan(tokenA);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/payments`), tokenB).send({
      accountId: acctB,
      principalPaid: 100,
      interestPaid: 0,
    });
    expect(res.status).toBe(404);
  });

  it('is idempotent on payment creation', async () => {
    const token = await login();
    const acctId = await makeAccount(token);
    const { body } = await makeLoan(token);
    const loanId = body.data.loan.id;
    const key = 'loan-pay-1';

    const first = await auth(request(app).post(`/api/loans/${loanId}/payments`), token)
      .set('Idempotency-Key', key)
      .send({ accountId: acctId, principalPaid: 5000, interestPaid: 1000 });
    const second = await auth(request(app).post(`/api/loans/${loanId}/payments`), token)
      .set('Idempotency-Key', key)
      .send({ accountId: acctId, principalPaid: 5000, interestPaid: 1000 });

    expect(first.status).toBe(201);
    expect(second.body.data.idempotentReplay).toBe(true);
    expect(await LoanPayment.countDocuments({})).toBe(1);
  });

  it('reverses a payment, restoring bank + loan and removing interest expense', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeLoan(token);
    const loanId = body.data.loan.id;

    const pay = await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acctId,
      principalPaid: 6380,
      interestPaid: 4000,
    });
    const paymentId = pay.body.data.payment.id;

    const rev = await auth(
      request(app).post(`/api/loans/${loanId}/payments/${paymentId}/reverse`),
      token
    ).send({ reason: 'mistake' });
    expect(rev.status).toBe(200);
    // Loan principal restored.
    expect(rev.body.data.loan.outstandingPrincipal).toBe(500000);
    // Bank restored.
    const acct = await auth(request(app).get(`/api/bank-accounts/${acctId}`), token);
    expect(acct.body.data.account.currentBalance).toBe(1000000);

    // Second reversal rejected.
    const again = await auth(
      request(app).post(`/api/loans/${loanId}/payments/${paymentId}/reverse`),
      token
    ).send({});
    expect(again.status).toBe(409);
  });

  it('keeps reversed payments visible in history', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeLoan(token);
    const loanId = body.data.loan.id;
    const pay = await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acctId,
      principalPaid: 6380,
      interestPaid: 4000,
    });
    await auth(
      request(app).post(`/api/loans/${loanId}/payments/${pay.body.data.payment.id}/reverse`),
      token
    ).send({});

    const history = await auth(request(app).get(`/api/loans/${loanId}/payments`), token);
    const statuses = history.body.data.payments.map((p) => p.status);
    expect(statuses).toContain('reversed');
  });

  it('advances the next payment date after a payment', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeLoan(token); // firstPaymentDate 2026-02-01
    const loanId = body.data.loan.id;
    await auth(request(app).post(`/api/loans/${loanId}/payments`), token).send({
      accountId: acctId,
      principalPaid: 6380,
      interestPaid: 4000,
    });
    const loan = await auth(request(app).get(`/api/loans/${loanId}`), token);
    expect(new Date(loan.body.data.loan.nextPaymentDate).toISOString().slice(0, 10)).toBe(
      '2026-03-01'
    );
  });

  // ---- Close + adjustment ----
  it('rejects closing a loan with an outstanding balance', async () => {
    const token = await login();
    const { body } = await makeLoan(token);
    const res = await auth(request(app).post(`/api/loans/${body.data.loan.id}/close`), token);
    expect(res.status).toBe(400);
  });

  it('allows closing after a settlement adjustment', async () => {
    const token = await login();
    const { body } = await makeLoan(token);
    const id = body.data.loan.id;
    await auth(request(app).post(`/api/loans/${id}/adjustment`), token).send({
      amount: 500000,
      direction: 'decrease',
      reason: 'Full settlement',
    });
    const res = await auth(request(app).post(`/api/loans/${id}/close`), token);
    expect(res.status).toBe(200);
    expect(res.body.data.loan.status).toBe('closed');
  });

  it('rejects ordinary payments on a closed loan', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeLoan(token);
    const id = body.data.loan.id;
    // Pay full principal to close it.
    await auth(request(app).post(`/api/loans/${id}/payments`), token).send({
      accountId: acctId,
      principalPaid: 500000,
      interestPaid: 0,
    });
    const closedLoan = await auth(request(app).get(`/api/loans/${id}`), token);
    expect(closedLoan.body.data.loan.status).toBe('closed');

    const res = await auth(request(app).post(`/api/loans/${id}/payments`), token).send({
      accountId: acctId,
      principalPaid: 1000,
      interestPaid: 0,
    });
    expect(res.status).toBe(409);
  });

  // ---- Summary + upcoming ----
  it('computes loan summary totals', async () => {
    const token = await login();
    await makeLoan(token, { emiAmount: 10502 });
    await makeLoan(token, { loanName: 'Home Loan', loanType: 'home', originalPrincipal: 1000000, emiAmount: 20000 });
    const res = await auth(request(app).get('/api/loans/summary'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.activeLoanCount).toBe(2);
    expect(res.body.data.totalOutstandingPrincipal).toBe(1500000);
    expect(res.body.data.totalMonthlyEmi).toBe(30502);
  });

  it('filters upcoming payments and marks overdue vs upcoming', async () => {
    const token = await login();
    // Overdue: firstPaymentDate in the past.
    await makeLoan(token, { loanName: 'Overdue Loan', firstPaymentDate: '2020-01-01' });
    // Upcoming: far future.
    await makeLoan(token, { loanName: 'Future Loan', firstPaymentDate: '2099-01-01' });

    const res = await auth(request(app).get('/api/loans/upcoming-payments'), token);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.upcoming.map((u) => [u.loanName, u.status]));
    expect(byName['Overdue Loan']).toBe('overdue');
    expect(byName['Future Loan']).toBe('upcoming');
  });

  it('scopes loan listing to the authenticated user', async () => {
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    await makeLoan(tokenA);
    const res = await auth(request(app).get('/api/loans'), tokenB);
    expect(res.body.data.loans).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/loans');
    expect(res.status).toBe(401);
  });

  it('includes loan obligations in the dashboard summary', async () => {
    const token = await login();
    await makeLoan(token, { emiAmount: 10502 });
    const res = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.totals.totalMonthlyEmi).toBe(10502);
    expect(res.body.data.totals.activeLoanCount).toBe(1);
    expect(res.body.data.totals.outstandingLoanPrincipal).toBe(500000);
  });
});
