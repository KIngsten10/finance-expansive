/**
 * Frontend money helpers. The backend sends and receives integer paise.
 * Convert at the UI boundary only.
 */
export function paiseToRupees(paise) {
  return paise / 100;
}

export function rupeesToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

export function formatInr(paise) {
  if (paise == null || Number.isNaN(paise)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

/**
 * Format a RUPEE number (as returned by the Phase 4 APIs) as an INR string.
 * `null`/undefined render as an em dash (used for genuinely unknown values).
 */
export function formatRupees(rupees) {
  if (rupees == null || Number.isNaN(Number(rupees))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(rupees));
}
