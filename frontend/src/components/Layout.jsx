import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar, { NAV_ITEMS } from './Sidebar.jsx';
import Header from './Header.jsx';

const TITLES = Object.fromEntries(NAV_ITEMS.map((n) => [n.to, n.label]));

/**
 * Application shell: collapsible desktop sidebar + sticky header + routed
 * content. On mobile the sidebar becomes a drawer with a backdrop.
 */
export default function Layout({ children }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const title = TITLES[location.pathname] || 'Finance Manager';

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />

      {drawerOpen && (
        <div
          className="drawer-backdrop mobile-only"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="app-main">
        <Header
          title={title}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
