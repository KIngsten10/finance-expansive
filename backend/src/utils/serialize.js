import { paiseToRupeesNumber } from './money.js';

/**
 * Serializers that convert internal integer-paise documents into API responses
 * where monetary amounts are rupee JSON numbers. Internal math stays in paise;
 * conversion happens only here at the boundary.
 */

export function serializeAccount(a) {
  return {
    id: (a._id ?? a.id)?.toString(),
    bankName: a.bankName,
    accountName: a.accountName,
    accountType: a.accountType,
    currency: a.currency,
    openingBalance: paiseToRupeesNumber(a.openingBalancePaise),
    currentBalance: paiseToRupeesNumber(a.currentBalancePaise),
    allowOverdraft: a.allowOverdraft,
    isActive: a.isActive,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function serializeExpenseRow(e) {
  return {
    id: (e._id ?? e.id)?.toString(),
    amount: paiseToRupeesNumber(e.amountPaise),
    category: e.category,
    description: e.description,
    expenseDate: e.expenseDate,
    accountId: e.accountId?.toString(),
    accountName: e.accountName,
    bankName: e.bankName,
    transactionId: e.transactionId?.toString(),
    status: e.status,
  };
}

export function serializeTransactionRow(t) {
  return {
    id: (t._id ?? t.id)?.toString(),
    type: t.type,
    amount: paiseToRupeesNumber(t.amountPaise),
    currency: t.currency,
    category: t.category,
    description: t.description,
    transactionDate: t.transactionDate,
    status: t.status,
    referenceId: t.referenceId?.toString(),
    referenceType: t.referenceType,
    reversalOfId: t.reversalOfId?.toString(),
    reversedById: t.reversedById?.toString(),
    sourceAccountId: t.sourceAccountId?.toString(),
    destinationAccountId: t.destinationAccountId?.toString(),
    sourceAccountName: t.sourceAccountName,
    destinationAccountName: t.destinationAccountName,
  };
}

export function serializeLoan(l) {
  return {
    id: (l._id ?? l.id)?.toString(),
    lenderName: l.lenderName,
    loanName: l.loanName,
    loanType: l.loanType,
    interestMethod: l.interestMethod,
    originalPrincipal: paiseToRupeesNumber(l.originalPrincipalPaise),
    outstandingPrincipal: paiseToRupeesNumber(l.outstandingPrincipalPaise),
    annualInterestRate: l.annualInterestRate,
    startDate: l.startDate,
    tenureMonths: l.tenureMonths,
    emiAmount: l.emiAmountPaise != null ? paiseToRupeesNumber(l.emiAmountPaise) : null,
    emiPaymentDay: l.emiPaymentDay ?? null,
    firstPaymentDate: l.firstPaymentDate ?? null,
    nextPaymentDate: l.nextPaymentDate ?? null,
    notes: l.notes ?? null,
    status: l.status,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

export function serializeLoanPayment(p) {
  return {
    id: (p._id ?? p.id)?.toString(),
    loanId: p.loanId?.toString(),
    accountId: p.accountId?.toString(),
    transactionId: p.transactionId?.toString(),
    paymentAmount: paiseToRupeesNumber(p.paymentAmountPaise),
    principalPaid: paiseToRupeesNumber(p.principalPaidPaise),
    interestPaid: paiseToRupeesNumber(p.interestPaidPaise),
    paymentDate: p.paymentDate,
    description: p.description ?? null,
    status: p.status,
    reversedById: p.reversedById?.toString(),
    reversalOfId: p.reversalOfId?.toString(),
    createdAt: p.createdAt,
  };
}

export function serializeInvestment(i) {
  return {
    id: (i._id ?? i.id)?.toString(),
    name: i.name,
    investmentType: i.investmentType,
    providerName: i.providerName ?? null,
    identifier: i.identifier ?? null,
    notes: i.notes ?? null,
    quantity: i.quantity ?? null,
    averageCost: i.averageCostPaise != null ? paiseToRupeesNumber(i.averageCostPaise) : null,
    totalInvested: paiseToRupeesNumber(i.totalInvestedPaise),
    currentValue: i.currentValuePaise != null ? paiseToRupeesNumber(i.currentValuePaise) : null,
    valuationDate: i.valuationDate ?? null,
    valuationSource: i.valuationSource ?? null,
    valuationIsManual: i.valuationIsManual ?? null,
    realizedGain: paiseToRupeesNumber(i.realizedGainPaise ?? 0),
    totalIncome: paiseToRupeesNumber(i.totalIncomePaise ?? 0),
    totalFees: paiseToRupeesNumber(i.totalFeesPaise ?? 0),
    purchaseDate: i.purchaseDate ?? null,
    currency: i.currency,
    status: i.status,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export function serializeInvestmentTxn(t) {
  return {
    id: (t._id ?? t.id)?.toString(),
    investmentId: t.investmentId?.toString(),
    investmentName: t.investmentName,
    accountId: t.accountId?.toString() ?? null,
    accountName: t.accountName ?? null,
    type: t.type,
    amount: paiseToRupeesNumber(t.amountPaise),
    fee: t.feePaise != null ? paiseToRupeesNumber(t.feePaise) : 0,
    quantity: t.quantity ?? null,
    unitPrice: t.unitPricePaise != null ? paiseToRupeesNumber(t.unitPricePaise) : null,
    realizedGain: t.realizedGainPaise != null ? paiseToRupeesNumber(t.realizedGainPaise) : null,
    description: t.description ?? null,
    transactionDate: t.transactionDate,
    status: t.status,
    reversalOfId: t.reversalOfId?.toString(),
  };
}
