import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Registration page. Mirrors the backend password policy client-side for
 * instant feedback, but the backend remains the source of truth.
 */
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [serverDetails, setServerDetails] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Name is required';

    if (!form.email.trim()) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errors.email = 'Enter a valid email';

    const pw = form.password;
    if (!pw) errors.password = 'Password is required';
    else if (pw.length < 8 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
      errors.password =
        'At least 8 characters with an uppercase letter, a lowercase letter, and a number';

    if (form.confirm !== form.password) errors.confirm = 'Passwords do not match';
    return errors;
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return; // prevent duplicate submissions

    setServerError(null);
    setServerDetails([]);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setServerError(err.message);
      // Surface backend field-level validation details if present.
      if (Array.isArray(err.details)) setServerDetails(err.details);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card shadow-sm" style={{ width: '100%', maxWidth: 460 }}>
        <div className="card-body p-4 p-sm-5">
          <h1 className="h4 mb-1 auth-brand">
            <span className="brand-mark" aria-hidden="true">₹</span> Create your account
          </h1>
          <p className="text-secondary mb-4">Start managing your finances</p>

          {serverError && (
            <div className="alert alert-danger" role="alert">
              {serverError}
              {serverDetails.length > 0 && (
                <ul className="mb-0 mt-2">
                  {serverDetails.map((d, i) => (
                    <li key={i}>{d.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label htmlFor="name" className="form-label">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                className={`form-control ${fieldErrors.name ? 'is-invalid' : ''}`}
                value={form.name}
                onChange={handleChange}
                disabled={submitting}
              />
              {fieldErrors.name && <div className="invalid-feedback">{fieldErrors.name}</div>}
            </div>

            <div className="mb-3">
              <label htmlFor="email" className="form-label">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className={`form-control ${fieldErrors.email ? 'is-invalid' : ''}`}
                value={form.email}
                onChange={handleChange}
                disabled={submitting}
              />
              {fieldErrors.email && <div className="invalid-feedback">{fieldErrors.email}</div>}
            </div>

            <div className="mb-3">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                className={`form-control ${fieldErrors.password ? 'is-invalid' : ''}`}
                value={form.password}
                onChange={handleChange}
                disabled={submitting}
              />
              {fieldErrors.password && (
                <div className="invalid-feedback">{fieldErrors.password}</div>
              )}
            </div>

            <div className="mb-3">
              <label htmlFor="confirm" className="form-label">
                Confirm password
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                className={`form-control ${fieldErrors.confirm ? 'is-invalid' : ''}`}
                value={form.confirm}
                onChange={handleChange}
                disabled={submitting}
              />
              {fieldErrors.confirm && (
                <div className="invalid-feedback">{fieldErrors.confirm}</div>
              )}
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                  Creating account…
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <p className="text-center text-muted mt-3 mb-0">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
