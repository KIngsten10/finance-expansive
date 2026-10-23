import apiClient from './client.js';

/** Loan API calls (reuse the shared Axios instance). */

export async function listLoans(params = {}) {
  const { data } = await apiClient.get('/loans', { params });
  return data.data;
}

export async function getLoan(id) {
  const { data } = await apiClient.get(`/loans/${id}`);
  return data.data.loan;
}

export async function createLoan(payload) {
  const { data } = await apiClient.post('/loans', payload);
  return data.data.loan;
}

export async function updateLoan(id, payload) {
  const { data } = await apiClient.patch(`/loans/${id}`, payload);
  return data.data.loan;
}

export async function calculateEmi(payload) {
  const { data } = await apiClient.post('/loans/calculate-emi', payload);
  return data.data;
}

export async function getLoanSchedule(id) {
  const { data } = await apiClient.get(`/loans/${id}/schedule`);
  return data.data;
}

export async function getLoanSummary() {
  const { data } = await apiClient.get('/loans/summary');
  return data.data;
}

export async function getUpcomingPayments(params = {}) {
  const { data } = await apiClient.get('/loans/upcoming-payments', { params });
  return data.data;
}

export async function listLoanPayments(id, params = {}) {
  const { data } = await apiClient.get(`/loans/${id}/payments`, { params });
  return data.data;
}

export async function recordLoanPayment(id, payload, idempotencyKey) {
  const { data } = await apiClient.post(`/loans/${id}/payments`, payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
  return data.data;
}

export async function reverseLoanPayment(id, paymentId, reason) {
  const { data } = await apiClient.post(`/loans/${id}/payments/${paymentId}/reverse`, { reason });
  return data.data;
}

export async function adjustLoan(id, payload) {
  const { data } = await apiClient.post(`/loans/${id}/adjustment`, payload);
  return data.data.loan;
}

export async function closeLoan(id) {
  const { data } = await apiClient.post(`/loans/${id}/close`);
  return data.data.loan;
}
