import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from './Spinner.jsx';

/**
 * Gate for login/register pages. Authenticated users are redirected to the
 * dashboard so they cannot see the auth forms again.
 */
export default function PublicOnlyRoute({ children }) {
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) return <Spinner label="Loading…" />;

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return children;
}
