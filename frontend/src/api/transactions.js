import apiClient from './client.js';

export async function listTransactions(params = {}) {
  const { data } = await apiClient.get('/transactions', { params });
  return data.data;
}
