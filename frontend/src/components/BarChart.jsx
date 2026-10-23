import { formatRupees } from '../utils/money.js';

/**
 * Dependency-free, theme-aware bar chart for the daily spending series. Each
 * datum is { date: 'YYYY-MM-DD', total: number }. Bars use the theme primary
 * color (via CSS var), scale to the max value, and expose an accessible
 * tooltip + title. Reduced-motion is respected globally.
 */
export default function BarChart({ data = [], ariaLabel = 'Daily spending' }) {
  const values = data.map((d) => d.total || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  if (data.length === 0 || total === 0) {
    return (
      <div className="d-flex align-items-center justify-content-center text-secondary" style={{ height: 180 }}>
        No spending in this period.
      </div>
    );
  }

  return (
    <div
      className="d-flex align-items-end gap-1"
      style={{ height: 180 }}
      role="img"
      aria-label={`${ariaLabel}. Highest ${formatRupees(max)}.`}
    >
      {data.map((d) => {
        const heightPct = Math.round(((d.total || 0) / max) * 100);
        const label = d.date.slice(5); // MM-DD
        return (
          <div
            key={d.date}
            className="flex-fill d-flex flex-column align-items-center justify-content-end h-100"
            title={`${d.date}: ${formatRupees(d.total)}`}
            style={{ minWidth: 0 }}
          >
            <div
              style={{
                width: '70%',
                maxWidth: 28,
                height: `${heightPct}%`,
                minHeight: d.total > 0 ? 3 : 0,
                background: 'linear-gradient(180deg, var(--primary), var(--accent))',
                borderRadius: '6px 6px 2px 2px',
                transition: 'height var(--transition)',
              }}
              aria-hidden="true"
            />
            <span
              className="text-secondary mt-1"
              style={{ fontSize: '0.62rem', whiteSpace: 'nowrap' }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
