import ThemeSwitcher from './ThemeSwitcher.jsx';
import Icon from './Icon.jsx';

/**
 * Top header: mobile menu button + desktop collapse toggle, the current page
 * title, and the theme switcher.
 */
export default function Header({ title, onToggleDrawer, onToggleCollapse }) {
  return (
    <header className="app-header">
      <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
        <button
          type="button"
          className="icon-btn mobile-only"
          aria-label="Open navigation menu"
          onClick={onToggleDrawer}
        >
          <Icon name="menu" size={20} />
        </button>
        <button
          type="button"
          className="icon-btn desktop-only"
          aria-label="Toggle sidebar"
          onClick={onToggleCollapse}
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="page-title text-truncate" aria-hidden="true">{title}</div>
      </div>

      <div className="header-actions">
        <ThemeSwitcher />
      </div>
    </header>
  );
}
