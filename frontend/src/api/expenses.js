import apiClient from './client.js';

/** Expense API calls (reuse the shared Axios instance). */

export async function listExpenses(params = {}) {
  const { data } = await apiClient.get('/expenses', { params });
  return data.data;
}

export async function getExpense(id) {
  const { data } = await apiClient.get(`/expenses/${id}`);
  return data.data;
}

/**
 * Create an expense. `idempotencyKey` is sent as a header so retrying the same
 * logical request is safe.
 */
export async function createExpense(payload, idempotencyKey) {
  const { data } = await apiClient.post('/expenses', payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
  return data.data;
}

export async function correctExpense(id, payload) {
  const { data } = await apiClient.patch(`/expenses/${id}`, payload);
  return data.data;
}

export async function reverseExpense(id, reason) {
  const { data } = await apiClient.post(`/expenses/${id}/reverse`, { reason });
  return data.data;
}

export async function deleteExpense(id) {
  const { data } = await apiClient.delete(`/expenses/${id}`);
  return data.data;
}
