import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from './Icon.jsx';

/**
 * Primary navigation. Collapsible on desktop (icon-only with tooltips); on
 * mobile it becomes a slide-in drawer controlled by Layout. Shows the
 * authenticated user and a logout action.
 */
export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/bank-accounts', label: 'Bank Accounts', icon: 'bank' },
  { to: '/expenses', label: 'Expenses', icon: 'expense' },
  { to: '/loans', label: 'Loans', icon: 'loan' },
  { to: '/investments', label: 'Investments', icon: 'investment' },
  { to: '/transactions', label: 'Transactions', icon: 'transactions' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'U'
  );
}

export default function Sidebar({ collapsed = false, open = false, onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside
      className={`app-sidebar${collapsed ? ' is-collapsed' : ''}${open ? ' is-open' : ''}`}
      aria-label="Primary navigation"
    >
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">₹</span>
        <span className="brand-name">Finance Manager</span>
      </div>

      <nav className="nav flex-column flex-grow-1" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="nav-link"
            title={collapsed ? item.label : undefined}
            onClick={onNavigate}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user">
            <span className="sidebar-avatar" aria-hidden="true">{initials(user.name)}</span>
            <div className="sidebar-footer-details small" style={{ minWidth: 0 }}>
              <div className="fw-semibold text-truncate" style={{ color: 'var(--sidebar-text-strong)' }}>
                {user.name}
              </div>
              <div className="text-truncate" style={{ opacity: 0.7 }}>{user.email}</div>
            </div>
          </div>
        )}
        <button
          type="button"
          className="btn btn-outline-light btn-sm w-100 d-flex align-items-center justify-content-center gap-2"
          onClick={handleLogout}
          title={collapsed ? 'Log out' : undefined}
        >
          <Icon name="logout" size={16} />
          <span className="nav-label">Log out</span>
        </button>
      </div>
    </aside>
  );
}
