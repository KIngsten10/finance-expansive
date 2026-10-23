import apiClient from './client.js';

/**
 * Auth API calls over the shared cookie-aware Axios instance. The server sets
 * HttpOnly session cookies on register/login and clears them on logout; this
 * module never handles raw tokens.
 */

export async function register({ name, email, password }) {
  const { data } = await apiClient.post('/auth/register', { name, email, password });
  return data.data; // { user, csrfToken }
}

export async function login({ email, password }) {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data.data; // { user, csrfToken }
}

export async function fetchMe() {
  const { data } = await apiClient.get('/auth/me');
  return data.data.user;
}

export async function logout() {
  try {
    await apiClient.post('/auth/logout');
  } catch {
    // Ignore network/logout errors — the server clears the cookie; the client
    // drops the in-memory user regardless.
  }
}
