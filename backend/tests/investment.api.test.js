import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { createApp } from '../src/app.js';
import { Expense } from '../src/models/Expense.js';
import { Investment } from '../src/models/Investment.js';

describe('Phase 6 investment APIs (replica set)', () => {
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

  async function login(email = 'inv@example.com') {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Inv User', email, password: 'StrongPassword123!' });
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
      openingBalance,
    });
    return res.body.data.account.id;
  }
  async function makeInvestment(token, overrides = {}) {
    const res = await auth(request(app).post('/api/investments'), token).send({
      name: 'Example Mutual Fund',
      investmentType: 'mutual_fund',
      providerName: 'Example AMC',
      ...overrides,
    });
    return res;
  }

  // ---- Profile CRUD ----
  it('creates an investment profile without moving money', async () => {
    const token = await login();
    const acctId = await makeAccount(token);
    const res = await makeInvestment(token);
    expect(res.status).toBe(201);
    expect(res.body.data.investment.totalInvested).toBe(0);
    expect(res.body.data.investment.currentValue).toBeNull();
    const acct = await auth(request(app).get(`/api/bank-accounts/${acctId}`), token);
    expect(acct.body.data.account.currentBalance).toBe(1000000);
  });

  it('rejects an invalid investment type', async () => {
    const token = await login();
    const res = await makeInvestment(token, { investmentType: 'tulips' });
    expect(res.status).toBe(400);
  });

  // ---- Purchase ----
  it('records a purchase: debits bank (amount+fee), adds to cost basis, not an expense', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;

    const res = await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      fee: 50,
      quantity: 10,
    });
    expect(res.status).toBe(201);
    // Bank debited by amount + fee = 3050.
    expect(res.body.data.account.currentBalance).toBe(1000000 / 1 - 3050);
    // Cost basis includes the fee.
    expect(res.body.data.investment.totalInvested).toBe(3050);
    expect(res.body.data.investment.quantity).toBe(10);
    // NOT an ordinary expense.
    expect(await Expense.countDocuments({})).toBe(0);
  });

  it('prevents a purchase with insufficient funds', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000);
    const { body } = await makeInvestment(token);
    const res = await auth(request(app).post(`/api/investments/${body.data.investment.id}/purchase`), token).send({
      accountId: acctId,
      amount: 5000,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient funds/i);
  });

  it('is idempotent on purchase', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    const first = await auth(request(app).post(`/api/investments/${invId}/purchase`), token)
      .set('Idempotency-Key', 'buy-1')
      .send({ accountId: acctId, amount: 3000, quantity: 10 });
    const second = await auth(request(app).post(`/api/investments/${invId}/purchase`), token)
      .set('Idempotency-Key', 'buy-1')
      .send({ accountId: acctId, amount: 3000, quantity: 10 });
    expect(first.status).toBe(201);
    expect(second.body.data.idempotentReplay).toBe(true);
    const inv = await auth(request(app).get(`/api/investments/${invId}`), token);
    expect(inv.body.data.investment.totalInvested).toBe(3000); // applied once
  });

  it("prevents cross-user investment and account access", async () => {
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    const acctA = await makeAccount(tokenA);
    const { body } = await makeInvestment(tokenB);
    // B's investment, A's account.
    const res = await auth(request(app).post(`/api/investments/${body.data.investment.id}/purchase`), tokenB).send({
      accountId: acctA,
      amount: 1000,
    });
    expect(res.status).toBe(404);
  });

  // ---- Sale ----
  it('records a partial sale, credits net proceeds, computes realized gain', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000, // avg cost 300/unit for 10 units
      quantity: 10,
    });
    // Sell 5 units for gross 2000, fee 50 -> net 1950; cost removed = 5*300=1500.
    const res = await auth(request(app).post(`/api/investments/${invId}/sale`), token).send({
      accountId: acctId,
      grossProceeds: 2000,
      fee: 50,
      quantity: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.investment.quantity).toBe(5);
    expect(res.body.data.investment.realizedGain).toBe(450); // 1950 - 1500
    // Bank: 1,000,000 - 3,000 + 1,950 = 998,950.
    expect(res.body.data.account.currentBalance).toBe(998950);
  });

  it('rejects selling more units than held', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      quantity: 10,
    });
    const res = await auth(request(app).post(`/api/investments/${invId}/sale`), token).send({
      accountId: acctId,
      grossProceeds: 1000,
      quantity: 50,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/more quantity than is held/i);
  });

  it('does not count sale proceeds as ordinary income (expense totals unaffected)', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      quantity: 10,
    });
    await auth(request(app).post(`/api/investments/${invId}/sale`), token).send({
      accountId: acctId,
      grossProceeds: 2000,
      quantity: 5,
    });
    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    // Purchases/sales never hit ordinary expense totals.
    expect(dash.body.data.totals.monthExpenses).toBe(0);
  });

  // ---- Income ----
  it('records dividend income crediting the bank without changing cost basis', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 100000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 50000,
      quantity: 10,
    });
    const costBefore = (await auth(request(app).get(`/api/investments/${invId}`), token)).body.data
      .investment.totalInvested;

    const res = await auth(request(app).post(`/api/investments/${invId}/income`), token).send({
      accountId: acctId,
      amount: 500,
      incomeType: 'dividend',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.investment.totalIncome).toBe(500);
    expect(res.body.data.investment.totalInvested).toBe(costBefore); // unchanged
    // Bank: 100000 - 50000 + 500 = 50500.
    expect(res.body.data.account.currentBalance).toBe(50500);
  });

  // ---- Fee (standalone) ----
  it('records a standalone fee as a bank debit and an ordinary expense', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 100000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    const res = await auth(request(app).post(`/api/investments/${invId}/fee`), token).send({
      accountId: acctId,
      amount: 200,
      description: 'Annual charge',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.account.currentBalance).toBe(100000 - 200);
    // Standalone fee IS an expense.
    const fees = await Expense.find({ category: 'investment_fee' });
    expect(fees).toHaveLength(1);
    expect(fees[0].amountPaise).toBe(20000);
  });

  // ---- Valuation ----
  it('updates valuation without changing cost basis or bank balance, and records history', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      quantity: 10,
    });

    const res = await auth(request(app).post(`/api/investments/${invId}/valuation`), token).send({
      currentValue: 3500,
      source: 'AMC statement',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.investment.currentValue).toBe(3500);
    expect(res.body.data.investment.valuationIsManual).toBe(true);
    expect(res.body.data.investment.totalInvested).toBe(3000); // cost basis unchanged
    // Bank unchanged by valuation.
    const acct = await auth(request(app).get(`/api/bank-accounts/${acctId}`), token);
    expect(acct.body.data.account.currentBalance).toBe(997000);
    // History recorded.
    const stored = await Investment.findById(invId);
    expect(stored.valuationHistory).toHaveLength(1);
  });

  it('keeps unknown valuation as null (never zero)', async () => {
    const token = await login();
    const { body } = await makeInvestment(token);
    const inv = await auth(request(app).get(`/api/investments/${body.data.investment.id}`), token);
    expect(inv.body.data.investment.currentValue).toBeNull();
  });

  // ---- Portfolio summary ----
  it('computes a portfolio summary with partial-valuation handling', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const a = (await makeInvestment(token, { name: 'Fund A' })).body.data.investment.id;
    const b = (await makeInvestment(token, { name: 'Fund B' })).body.data.investment.id;
    await auth(request(app).post(`/api/investments/${a}/purchase`), token).send({
      accountId: acctId,
      amount: 10000,
      quantity: 10,
    });
    await auth(request(app).post(`/api/investments/${b}/purchase`), token).send({
      accountId: acctId,
      amount: 20000,
      quantity: 20,
    });
    // Only A has a known valuation.
    await auth(request(app).post(`/api/investments/${a}/valuation`), token).send({
      currentValue: 12000,
    });

    const res = await auth(request(app).get('/api/investments/summary'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.totalCostBasis).toBe(30000);
    expect(res.body.data.knownCurrentValue).toBe(12000);
    expect(res.body.data.valuationComplete).toBe(false);
    expect(res.body.data.holdingsWithUnknownValue).toBe(1);
    // Unrealized gain only over A: 12000 - 10000 = 2000.
    expect(res.body.data.unrealizedGain).toBe(2000);
  });

  // ---- Reversal ----
  it('reverses a purchase atomically (restores bank + holdings), single-use', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      quantity: 10,
    });

    // Find the investment txn id.
    const hist = await auth(request(app).get(`/api/investments/transactions?investmentId=${invId}`), token);
    const txnId = hist.body.data.transactions[0].id;

    const rev = await auth(
      request(app).post(`/api/investments/transactions/${txnId}/reverse`),
      token
    ).send({ reason: 'mistake' });
    expect(rev.status).toBe(200);

    const inv = await auth(request(app).get(`/api/investments/${invId}`), token);
    expect(inv.body.data.investment.totalInvested).toBe(0);
    expect(inv.body.data.investment.quantity).toBe(0);
    const acct = await auth(request(app).get(`/api/bank-accounts/${acctId}`), token);
    expect(acct.body.data.account.currentBalance).toBe(1000000);

    // Second reversal rejected.
    const again = await auth(
      request(app).post(`/api/investments/transactions/${txnId}/reverse`),
      token
    ).send({});
    expect(again.status).toBe(409);
  });

  it('keeps reversed investment transactions visible in history', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 3000,
      quantity: 10,
    });
    const hist = await auth(request(app).get(`/api/investments/transactions?investmentId=${invId}`), token);
    const txnId = hist.body.data.transactions[0].id;
    await auth(request(app).post(`/api/investments/transactions/${txnId}/reverse`), token).send({});

    const after = await auth(request(app).get(`/api/investments/transactions?investmentId=${invId}`), token);
    const statuses = after.body.data.transactions.map((t) => t.status);
    expect(statuses).toContain('reversed');
  });

  it('scopes investment listing to the authenticated user', async () => {
    const tokenA = await login('a@example.com');
    const tokenB = await login('b@example.com');
    await makeInvestment(tokenA);
    const res = await auth(request(app).get('/api/investments'), tokenB);
    expect(res.body.data.investments).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/investments');
    expect(res.status).toBe(401);
  });

  it('exposes investment metrics on the dashboard summary', async () => {
    const token = await login();
    const acctId = await makeAccount(token, 1000000);
    const { body } = await makeInvestment(token);
    const invId = body.data.investment.id;
    await auth(request(app).post(`/api/investments/${invId}/purchase`), token).send({
      accountId: acctId,
      amount: 10000,
      quantity: 10,
    });
    await auth(request(app).post(`/api/investments/${invId}/valuation`), token).send({
      currentValue: 12000,
    });
    const dash = await auth(request(app).get('/api/dashboard/summary'), token);
    expect(dash.body.data.totals.totalInvestmentCostBasis).toBe(10000);
    expect(dash.body.data.totals.investmentCurrentValue).toBe(12000);
    expect(dash.body.data.totals.investmentUnrealizedGain).toBe(2000);
    expect(dash.body.data.totals.investmentValuationComplete).toBe(true);
  });
});
