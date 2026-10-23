import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startReplSet, stopReplSet, clearDatabase } from './helpers/replset.js';
import { BankAccount } from '../src/models/BankAccount.js';
import { Investment } from '../src/models/Investment.js';
import { Transaction } from '../src/models/Transaction.js';
import { Expense } from '../src/models/Expense.js';
import {
  recordInvestmentPurchase,
  recordInvestmentSale,
} from '../src/services/investment.service.js';

describe('investment accounting (replica set)', () => {
  let replset;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replset = await startReplSet();
  });
  afterEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await stopReplSet(replset);
  });

  async function setup() {
    const account = await BankAccount.create({
      userId,
      bankName: 'Bank',
      accountName: 'Main',
      openingBalancePaise: 1000000,
      currentBalancePaise: 1000000,
    });
    const investment = await Investment.create({
      userId,
      name: 'ACME',
      investmentType: 'stock',
      totalInvestedPaise: 0,
    });
    return { account, investment };
  }

  it('purchase decreases bank balance and increases cost basis (not an expense)', async () => {
    const { account, investment } = await setup();
    const { investment: updated } = await recordInvestmentPurchase({
      userId,
      investmentId: investment._id,
      accountId: account._id,
      amountPaise: 300000, // ₹3,000
      quantity: 10,
    });

    expect((await BankAccount.findById(account._id)).currentBalancePaise).toBe(700000);
    expect(updated.totalInvestedPaise).toBe(300000);
    expect(updated.quantity).toBe(10);
    expect(updated.averageCostPaise).toBe(30000); // 300000 / 10

    // Must NOT create an expense.
    expect(await Expense.countDocuments({ userId })).toBe(0);
    const txn = await Transaction.findOne({ userId, type: 'investment_purchase' });
    expect(txn).not.toBeNull();
  });

  it('sale credits the bank, reduces basis, and reports realized gain', async () => {
    const { account, investment } = await setup();
    await recordInvestmentPurchase({
      userId,
      investmentId: investment._id,
      accountId: account._id,
      amountPaise: 300000,
      quantity: 10,
    });
    // Sell 5 units for ₹2,000 (cost basis removed = 5 * 30000 = 150000).
    const { realizedGainPaise, investment: afterSale } = await recordInvestmentSale({
      userId,
      investmentId: investment._id,
      accountId: account._id,
      amountPaise: 200000,
      quantity: 5,
    });

    expect(realizedGainPaise).toBe(50000); // 200000 - 150000
    expect(afterSale.quantity).toBe(5);
    expect(afterSale.totalInvestedPaise).toBe(150000);
    // Bank: 1,000,000 - 300,000 + 200,000 = 900,000.
    expect((await BankAccount.findById(account._id)).currentBalancePaise).toBe(900000);
  });

  it('keeps unknown current value as null (never zero)', async () => {
    const { investment } = await setup();
    const fresh = await Investment.findById(investment._id);
    expect(fresh.currentValuePaise).toBeNull();
  });

  it('rejects selling more quantity than held', async () => {
    const { account, investment } = await setup();
    await recordInvestmentPurchase({
      userId,
      investmentId: investment._id,
      accountId: account._id,
      amountPaise: 300000,
      quantity: 10,
    });
    await expect(
      recordInvestmentSale({
        userId,
        investmentId: investment._id,
        accountId: account._id,
        amountPaise: 100000,
        quantity: 50,
      })
    ).rejects.toThrow(/more quantity than is held/i);
  });
});
