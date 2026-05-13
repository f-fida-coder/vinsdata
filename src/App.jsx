import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
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
import PipelinePage from './pages/PipelinePage';
import ReportsPage from './pages/ReportsPage';
import BillOfSalePage from './pages/BillOfSalePage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import { Sidebar, Topbar, CommandPalette, QuickAddMenu, ShortcutsOverlay } from './components/Shell';

const LANDING_BY_ROLE = {
  admin:    '/',
  marketer: '/marketing',
  carfax:   '/leads',
  filter:   '/leads',
  tlo:      '/leads',
};

function DashboardLayout() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const { toggle } = useTheme();
  const navigate = useNavigate();
  const landing = LANDING_BY_ROLE[user?.role] || '/';

  const rootElement = landing === '/' ? <DashboardPage /> : <Navigate to={landing} replace />;

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const isInput = e.target.matches?.('input,textarea,select,[contenteditable]');
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen(true); }
      else if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); setQaOpen((o) => !o); }
      else if (meta && e.key === '.') { e.preventDefault(); toggle(); }
      else if (e.key === '?' && !isInput) { e.preventDefault(); setShortcutsOpen(true); }
      else if (e.key === 'Escape') { setQaOpen(false); }
      else if (!meta && !isInput) {
        if (e.key.toLowerCase() === 'g') { window.__gWaiting = true; setTimeout(() => { window.__gWaiting = false; }, 800); return; }
        if (window.__gWaiting) {
          const map = { d: '/', l: '/leads', p: '/pipeline', t: '/tasks', r: '/reports', v: '/vehicles', m: '/marketing', u: '/users' };
          const r = map[e.key.toLowerCase()];
          if (r) { navigate(r); window.__gWaiting = false; }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, navigate]);

  return (
    <div className="app">
      <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
      <main className="main">
        <Topbar
          onSearch={() => setCmdkOpen(true)}
          onQuickAdd={() => setQaOpen((o) => !o)}
          onShortcuts={() => setShortcutsOpen(true)}
          onMenuToggle={() => setSidebarOpen((o) => !o)}
        />
        <Routes>
          <Route path="/" element={rootElement} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route path="/merge-prep" element={<MergePrepPage />} />
          <Route path="/marketing" element={<MarketingCampaignsPage />} />
          <Route path="/marketing/new" element={<MarketingComposerPage />} />
          <Route path="/marketing/:id" element={<MarketingDetailPage />} />
          <Route path="/bill-of-sale" element={<BillOfSalePage />} />
          <Route path="/dispatch" element={<Navigate to="/bill-of-sale" replace />} />
          <Route path="/company-settings" element={<CompanySettingsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to={landing} replace />} />
        </Routes>
      </main>

      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
      <QuickAddMenu open={qaOpen} onClose={() => setQaOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <ThemeProvider>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, border: '3px solid var(--bg-2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        {user ? <DashboardLayout /> : <LoginPage />}
      </BrowserRouter>
    </ThemeProvider>
  );
}
