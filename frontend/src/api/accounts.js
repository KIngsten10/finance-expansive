import apiClient from './client.js';

/** Bank account API calls (reuse the shared Axios instance). */

export async function listAccounts() {
  const { data } = await apiClient.get('/bank-accounts');
  return data.data.accounts;
}

export async function createAccount(payload) {
  const { data } = await apiClient.post('/bank-accounts', payload);
  return data.data.account;
}

export async function getAccount(id) {
  const { data } = await apiClient.get(`/bank-accounts/${id}`);
  return data.data.account;
}

export async function getAccountTransactions(id, params = {}) {
  const { data } = await apiClient.get(`/bank-accounts/${id}/transactions`, { params });
  return data.data;
}

export async function updateAccount(id, payload) {
  const { data } = await apiClient.patch(`/bank-accounts/${id}`, payload);
  return data.data.account;
}

export async function deactivateAccount(id) {
  const { data } = await apiClient.delete(`/bank-accounts/${id}`);
  return data.data.account;
}
