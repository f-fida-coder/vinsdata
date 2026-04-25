import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VehiclesPage from './pages/VehiclesPage';
import UsersPage from './pages/UsersPage';
import LogsPage from './pages/LogsPage';
import LeadsPage from './pages/LeadsPage';
import DuplicatesPage from './pages/DuplicatesPage';
import TasksPage from './pages/TasksPage';
import MergePrepPage from './pages/MergePrepPage';
import MarketingCampaignsPage from './pages/MarketingCampaignsPage';
import MarketingComposerPage from './pages/MarketingComposerPage';
import MarketingDetailPage from './pages/MarketingDetailPage';
import FilterRulesPage from './pages/FilterRulesPage';
import FilterReviewPage from './pages/FilterReviewPage';
import NotificationBell from './components/NotificationBell';

const NAV_ICONS = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    </svg>
  ),
  vehicles: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 17h.01M12 17h.01M16 17h.01M3 11l2-6h14l2 6M5 17v2m14-2v2M5 11h14v6H5z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" />
    </svg>
  ),
  leads: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 014-4h1m4-6a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  duplicates: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  filter: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  ),
  tasks: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  mergePrep: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h10M7 16h5m-2-8v10m4-8l4 4m0 0l-4 4m4-4H12" />
    </svg>
  ),
  marketing: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  ),
  logout: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
    </svg>
  ),
};

function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
      isActive
        ? 'text-white'
        : 'hover:bg-[var(--vv-bg-sidebar-hover)]'
    }`;

  const linkStyle = ({ isActive }) => ({
    backgroundColor: isActive ? 'var(--vv-bg-sidebar-active)' : 'transparent',
    color: isActive ? 'var(--vv-text-sidebar)' : 'var(--vv-text-sidebar-muted)',
  });

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-50 h-screen
          w-[232px] flex flex-col
          transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
        style={{
          backgroundColor: 'var(--vv-bg-sidebar)',
          borderRight: '1px solid var(--vv-border-sidebar)',
        }}
      >
        {/* Brand */}
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{ backgroundColor: 'var(--vv-accent)' }}
            >
              <span className="text-white font-semibold text-[13px]">V</span>
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--vv-text-sidebar)' }}>Vin Vault</div>
              <div className="text-[10px]" style={{ color: 'var(--vv-text-sidebar-dim)' }}>CRM</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--vv-bg-sidebar-hover)]"
            style={{ color: 'var(--vv-text-sidebar-muted)' }}
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* User card */}
        <div
          className="mx-3 mb-3 px-2.5 py-2 rounded-md flex items-center gap-2.5"
          style={{
            backgroundColor: 'var(--vv-bg-sidebar-hover)',
            border: '1px solid var(--vv-border-sidebar)',
          }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-semibold shrink-0 uppercase"
            style={{ backgroundColor: 'var(--vv-bg-sidebar-active)', color: 'var(--vv-text-sidebar)' }}
          >
            {user.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate" style={{ color: 'var(--vv-text-sidebar)' }}>{user.name}</div>
            <div className="text-[10px] capitalize" style={{ color: 'var(--vv-text-sidebar-dim)' }}>{user.role}</div>
          </div>
          <NotificationBell tone="dark" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider px-3 mb-1.5 mt-1" style={{ color: 'var(--vv-text-sidebar-dim)' }}>Menu</p>
          <NavLink to="/" end className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.dashboard} Dashboard</NavLink>
          <NavLink to="/vehicles" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.vehicles} Vehicles</NavLink>
          <NavLink to="/leads" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.leads} Leads</NavLink>
          <NavLink to="/tasks" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.tasks} Tasks</NavLink>
          <NavLink to="/duplicates" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.duplicates} Duplicate Review</NavLink>
          <NavLink to="/merge-prep" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.mergePrep} Merge Prep</NavLink>
          <NavLink to="/filter-review" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.filter} Filter Review</NavLink>
          {(user.role === 'admin' || user.role === 'marketer') && (
            <NavLink to="/marketing" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.marketing} Marketing</NavLink>
          )}
          {user.role === 'admin' && (
            <>
              <NavLink to="/filter-rules" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.filter} Filter Rules</NavLink>
              <NavLink to="/users" className={linkClass} style={linkStyle} onClick={onClose}>{NAV_ICONS.users} Users</NavLink>
            </>
          )}
        </nav>

        {/* Logout */}
        <div className="p-3">
          <button
            onClick={() => { onClose(); logout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium rounded-md hover:bg-[var(--vv-bg-sidebar-hover)] transition-colors"
            style={{ color: 'var(--vv-text-sidebar-muted)' }}
          >
            {NAV_ICONS.logout} Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

function MobileHeader({ onMenuOpen }) {
  return (
    <div
      className="lg:hidden sticky top-0 z-30 px-4 py-2.5 flex items-center gap-3"
      style={{
        backgroundColor: 'var(--vv-bg-surface)',
        borderBottom: '1px solid var(--vv-border)',
      }}
    >
      <button
        onClick={onMenuOpen}
        className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--vv-bg-surface-muted)] transition-colors"
        style={{ color: 'var(--vv-text-muted)' }}
        aria-label="Open menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ backgroundColor: 'var(--vv-accent)' }}
        >
          <span className="text-white font-semibold text-[11px]">V</span>
        </div>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--vv-text)' }}>Vin Vault</span>
      </div>
      <div className="ml-auto">
        <NotificationBell tone="light" />
      </div>
    </div>
  );
}

function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileHeader onMenuOpen={() => setSidebarOpen(true)} />
        <main
          className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto"
          style={{ backgroundColor: 'var(--vv-bg-app)' }}
        >
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/duplicates" element={<DuplicatesPage />} />
            <Route path="/merge-prep" element={<MergePrepPage />} />
            <Route path="/marketing" element={<MarketingCampaignsPage />} />
            <Route path="/marketing/new" element={<MarketingComposerPage />} />
            <Route path="/marketing/:id" element={<MarketingDetailPage />} />
            <Route path="/filter-rules" element={<FilterRulesPage />} />
            <Route path="/filter-review" element={<FilterReviewPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--vv-bg-app)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--vv-border-strong)', borderTopColor: 'var(--vv-accent)' }}
          />
          <p className="text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {user ? <DashboardLayout /> : <LoginPage />}
    </BrowserRouter>
  );
}
