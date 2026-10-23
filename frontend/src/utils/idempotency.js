/**
 * Generate a client-side idempotency key for a financial write. A key is bound
 * to one logical submission so retries (network errors, double clicks) do not
 * create duplicate transactions on the server.
 */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
