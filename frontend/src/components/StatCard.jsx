import Icon from './Icon.jsx';

/**
 * Premium financial summary card. `valueClass` applies a semantic color only as
 * an accent — meaning is always carried by the label/subtitle text too (never
 * color alone). `icon` + `tone` render a soft colored glyph.
 */
export default function StatCard({
  label,
  value,
  subtitle,
  icon,
  tone = 'primary',
  valueClass = '',
}) {
  return (
    <div className="card app-card--interactive h-100">
      <div className="stat-card">
        <div className="stat-head">
          <span className="stat-label">{label}</span>
          {icon && (
            <span className={`stat-icon i-${tone}`}>
              <Icon name={icon} size={18} />
            </span>
          )}
        </div>
        <div className={`stat-value fin-figure ${valueClass}`}>{value}</div>
        {subtitle != null && <div className="stat-sub">{subtitle}</div>}
      </div>
    </div>
  );
}
