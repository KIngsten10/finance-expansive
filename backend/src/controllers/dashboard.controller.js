import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { paiseToRupeesNumber } from '../utils/money.js';
import { serializeTransactionRow } from '../utils/serialize.js';
import {
  getDashboardSummary,
  getAccountSummary,
  getRecentTransactions,
  getExpenseCategoryBreakdown,
  getDailyExpenseTotals,
} from '../services/dashboard.service.js';
import { getLoanSummary, getUpcomingPayments } from '../services/loan.service.js';
import { getPortfolioSummary } from '../services/investment.service.js';

/**
 * GET /api/dashboard/summary
 * Aggregates all dashboard data in one call. Monetary values are serialized to
 * rupee numbers; unknown investment valuation is reported as `null` (never a
 * verified zero) alongside counts of known/unknown holdings.
 */
export const summary = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const ref = new Date();

  const [core, accounts, recent, categoryBreakdown, dailyTotals, loanSummary, upcoming, portfolio] =
    await Promise.all([
      getDashboardSummary(userId, ref),
      getAccountSummary(userId),
      getRecentTransactions(userId, 10),
      getExpenseCategoryBreakdown(userId, ref),
      getDailyExpenseTotals(userId, ref, 14),
      getLoanSummary(userId, ref),
      getUpcomingPayments(userId, { limit: 1 }),
      getPortfolioSummary(userId),
    ]);

  const nextUpcoming = upcoming.rows[0] || null;

  const valuation = core.investmentValuation;
  // Current value is "unknown" (null) unless every holding has a known value.
  const investmentCurrentValue =
    valuation.holdingsWithUnknownValue === 0 && valuation.holdingsWithKnownValue > 0
      ? paiseToRupeesNumber(valuation.knownValuationPaise)
      : null;

  // Unrealized gain only over holdings with a known valuation; null when none.
  const investmentUnrealizedGain =
    portfolio.unrealizedGainKnownPaise != null
      ? paiseToRupeesNumber(portfolio.unrealizedGainKnownPaise)
      : null;

  sendSuccess(res, {
    totals: {
      totalBankBalance: paiseToRupeesNumber(core.totalBankBalancePaise),
      todayExpenses: paiseToRupeesNumber(core.expensesTodayPaise),
      monthExpenses: paiseToRupeesNumber(core.expensesThisMonthPaise),
      outstandingLoanPrincipal: paiseToRupeesNumber(core.outstandingLoanPrincipalPaise),
      totalInvestmentCostBasis: paiseToRupeesNumber(core.investmentCostBasisPaise),
      investmentCurrentValue,
      // Transparency about valuation coverage.
      investmentKnownValue: paiseToRupeesNumber(valuation.knownValuationPaise),
      investmentHoldingsWithKnownValue: valuation.holdingsWithKnownValue,
      investmentHoldingsWithUnknownValue: valuation.holdingsWithUnknownValue,
      investmentValuationComplete: portfolio.valuationComplete,
      investmentRealizedGain: paiseToRupeesNumber(portfolio.realizedGainPaise),
      investmentUnrealizedGain,
      // Loan obligations (reuses the loan service aggregation — no duplication).
      totalMonthlyEmi: paiseToRupeesNumber(loanSummary.totalMonthlyEmiPaise),
      activeLoanCount: loanSummary.activeLoanCount,
      upcomingPaymentCount: loanSummary.upcomingPaymentCount,
      overduePaymentCount: loanSummary.overduePaymentCount,
    },
    nextUpcomingEmi: nextUpcoming
      ? {
        loanId: nextUpcoming.loanId.toString(),
        loanName: nextUpcoming.loanName,
        lenderName: nextUpcoming.lenderName,
        dueDate: nextUpcoming.dueDate,
        scheduledEmi:
          nextUpcoming.scheduledEmiPaise != null
            ? paiseToRupeesNumber(nextUpcoming.scheduledEmiPaise)
            : null,
        status: nextUpcoming.status,
      }
      : null,
    accounts: accounts.map((a) => ({
      id: a.id,
      bankName: a.bankName,
      accountName: a.accountName,
      accountType: a.accountType,
      currentBalance: paiseToRupeesNumber(a.currentBalancePaise),
    })),
    recentTransactions: recent.map(serializeTransactionRow),
    expenseCategoryBreakdown: categoryBreakdown.map((c) => ({
      category: c.category,
      total: paiseToRupeesNumber(c.totalPaise),
    })),
    dailyExpenseTotals: dailyTotals.map((d) => ({
      date: d.date,
      total: paiseToRupeesNumber(d.totalPaise),
    })),
  });
});
