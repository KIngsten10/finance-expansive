import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import Icon from '../components/Icon.jsx';

const THEME_OPTIONS = [
  { value: 'light', icon: 'sun', label: 'Light', hint: 'Always use the light theme' },
  { value: 'dark', icon: 'moon', label: 'Dark', hint: 'Always use the dark theme' },
  { value: 'system', icon: 'monitor', label: 'System', hint: 'Match your device setting' },
];

export default function Settings() {
  const { user, logout } = useAuth();
  const { preference, setTheme } = useTheme();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-subtitle">Manage your appearance and account</div>
        </div>
      </div>

      <div className="row g-4" style={{ maxWidth: 760 }}>
        {/* Appearance */}
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h2 className="section-title">Appearance</h2>
              <div className="row g-3">
                {THEME_OPTIONS.map((opt) => {
                  const active = preference === opt.value;
                  return (
                    <div className="col-12 col-sm-4" key={opt.value}>
                      <button
                        type="button"
                        className="w-100 text-start app-card app-card--interactive p-3"
                        aria-pressed={active}
                        onClick={() => setTheme(opt.value)}
                        style={{
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                          borderWidth: 2,
                          boxShadow: active ? '0 0 0 3px var(--primary-soft)' : undefined,
                        }}
                      >
                        <span
                          className="stat-icon i-primary mb-2"
                          style={{ display: 'inline-flex' }}
                        >
                          <Icon name={opt.icon} size={18} />
                        </span>
                        <div className="fw-semibold d-flex align-items-center gap-2">
                          {opt.label}
                          {active && (
                            <span className="badge text-bg-success">Active</span>
                          )}
                        </div>
                        <div className="small text-secondary mt-1">{opt.hint}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Profile (read-only — backend exposes no profile-edit endpoint) */}
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <h2 className="section-title">Profile</h2>
              {user ? (
                <dl className="row mb-0">
                  <dt className="col-sm-4 text-secondary fw-normal">Name</dt>
                  <dd className="col-sm-8 fw-semibold">{user.name}</dd>
                  <dt className="col-sm-4 text-secondary fw-normal">Email</dt>
                  <dd className="col-sm-8 fw-semibold">{user.email}</dd>
                  <dt className="col-sm-4 text-secondary fw-normal">Currency</dt>
                  <dd className="col-sm-8 fw-semibold">{user.currency || 'INR'}</dd>
                </dl>
              ) : (
                <p className="text-secondary mb-0">Not signed in.</p>
              )}
              <p className="small text-secondary mt-3 mb-0">
                Profile editing is not available in this version.
              </p>
            </div>
          </div>
        </div>

        {/* Session */}
        <div className="col-12">
          <div className="card">
            <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
              <div>
                <h2 className="section-title mb-1">Session</h2>
                <div className="small text-secondary">Sign out of your account on this device.</div>
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary d-flex align-items-center gap-2"
                onClick={handleLogout}
              >
                <Icon name="logout" size={16} /> Log out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
