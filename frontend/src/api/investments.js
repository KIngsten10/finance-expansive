import apiClient from './client.js';

/** Investment API calls (reuse the shared Axios instance). */

export async function listInvestments(params = {}) {
  const { data } = await apiClient.get('/investments', { params });
  return data.data;
}

export async function getInvestment(id) {
  const { data } = await apiClient.get(`/investments/${id}`);
  return data.data.investment;
}

export async function createInvestment(payload) {
  const { data } = await apiClient.post('/investments', payload);
  return data.data.investment;
}

export async function updateInvestment(id, payload) {
  const { data } = await apiClient.patch(`/investments/${id}`, payload);
  return data.data.investment;
}

export async function getPortfolioSummary() {
  const { data } = await apiClient.get('/investments/summary');
  return data.data;
}

export async function listInvestmentTransactions(params = {}) {
  const { data } = await apiClient.get('/investments/transactions', { params });
  return data.data;
}

function withIdem(idempotencyKey) {
  return idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined;
}

export async function recordPurchase(id, payload, idempotencyKey) {
  const { data } = await apiClient.post(`/investments/${id}/purchase`, payload, withIdem(idempotencyKey));
  return data.data;
}

export async function recordSale(id, payload, idempotencyKey) {
  const { data } = await apiClient.post(`/investments/${id}/sale`, payload, withIdem(idempotencyKey));
  return data.data;
}

export async function recordIncome(id, payload, idempotencyKey) {
  const { data } = await apiClient.post(`/investments/${id}/income`, payload, withIdem(idempotencyKey));
  return data.data;
}

export async function recordFee(id, payload, idempotencyKey) {
  const { data } = await apiClient.post(`/investments/${id}/fee`, payload, withIdem(idempotencyKey));
  return data.data;
}

export async function updateValuation(id, payload) {
  const { data } = await apiClient.post(`/investments/${id}/valuation`, payload);
  return data.data.investment;
}

export async function reverseInvestmentTransaction(txnId, reason) {
  const { data } = await apiClient.post(`/investments/transactions/${txnId}/reverse`, { reason });
  return data.data;
}
