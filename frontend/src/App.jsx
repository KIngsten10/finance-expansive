import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Placeholder from './components/Placeholder.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import BankAccounts from './pages/BankAccounts.jsx';
import Expenses from './pages/Expenses.jsx';
import Transactions from './pages/Transactions.jsx';
import Loans from './pages/Loans.jsx';
import Investments from './pages/Investments.jsx';
import Settings from './pages/Settings.jsx';

/**
 * Wraps a protected page in the authenticated app shell (sidebar + layout).
 * ProtectedRoute redirects unauthenticated users to /login.
 */
function Protected({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

/**
 * Route table.
 * - /login, /register are public and redirect authenticated users to /dashboard.
 * - All application routes are protected.
 * - Business-module pages remain placeholders until their phases land.
 */
export default function App() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <Register />
          </PublicOnlyRoute>
        }
      />

      {/* Protected application routes */}
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/bank-accounts" element={<Protected><BankAccounts /></Protected>} />
      <Route path="/expenses" element={<Protected><Expenses /></Protected>} />
      <Route path="/loans" element={<Protected><Loans /></Protected>} />
      <Route path="/investments" element={<Protected><Investments /></Protected>} />
      <Route path="/transactions" element={<Protected><Transactions /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />

      {/* Default + catch-all */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
