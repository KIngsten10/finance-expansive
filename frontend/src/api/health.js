import apiClient from './client.js';

/** Calls GET /api/health and returns the unwrapped data payload. */
export async function getHealth() {
  const { data } = await apiClient.get('/health');
  return data.data;
}
