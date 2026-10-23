import { formatRupees } from '../utils/money.js';

const TONES = ['var(--primary)', 'var(--accent)', 'var(--success)', 'var(--warning)', 'var(--info)'];

/**
 * Horizontal category breakdown. `data` is [{ category, total }]. Each row
 * shows the category, amount, and a proportional bar. Meaning is in the text;
 * color is decorative.
 */
export default function CategoryBars({ data = [] }) {
  if (data.length === 0) {
    return <p className="text-secondary mb-0">No expenses this month.</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.total || 0));

  return (
    <ul className="list-unstyled mb-0 d-flex flex-column gap-3">
      {data.map((c, i) => (
        <li key={c.category}>
          <div className="d-flex justify-content-between align-items-baseline mb-1">
            <span className="text-truncate" style={{ maxWidth: '60%' }}>{c.category}</span>
            <span className="fw-semibold fin-figure">{formatRupees(c.total)}</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: 'var(--surface-secondary)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(((c.total || 0) / max) * 100)}%`,
                background: TONES[i % TONES.length],
                borderRadius: 999,
              }}
              aria-hidden="true"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
