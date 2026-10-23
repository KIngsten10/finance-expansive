import axios from 'axios';

/**
 * Shared Axios instance. Base URL comes from VITE_API_URL (see .env).
 *
 * Authentication is COOKIE-BASED: the backend sets an HttpOnly JWT cookie that
 * the browser sends automatically, so this client never reads or stores the
 * token in JavaScript (no localStorage). `withCredentials: true` ensures the
 * auth + CSRF cookies travel with every request.
 *
 * CSRF: for state-changing requests we echo the readable `csrf_token` cookie in
 * an `X-CSRF-Token` header (double-submit pattern). Safe methods are exempt.
 */
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true,
});

const CSRF_COOKIE_NAME = 'csrf_token';
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Read a non-HttpOnly cookie value by name. */
function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Attach the CSRF token header on state-changing requests.
apiClient.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (UNSAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) {
      config.headers['X-CSRF-Token'] = csrf;
    }
  }
  return config;
});

// Normalize the error shape coming from the API envelope. We preserve the
// backend's field-level `details` and HTTP `status` on the thrown Error so UI
// code can show per-field validation messages while still relying on
// `error.message` for the summary.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error.response?.data;
    const message = data?.message || error.message || 'An unexpected error occurred';
    const normalized = new Error(message);
    if (data?.details) normalized.details = data.details;
    if (error.response?.status) normalized.status = error.response.status;
    return Promise.reject(normalized);
  }
);

export default apiClient;
