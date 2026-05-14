// VINVAULT app shell: Sidebar, Topbar, CommandPalette, QuickAdd, Shortcuts overlay
import { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Icon, Avatar, Button, Kbd } from './ui';
import NotificationBellRaw from './NotificationBell';

// Tailwind's `sm` breakpoint: anything below this is a phone-sized layout that
// gets the off-canvas sidebar treatment.
const MOBILE_BREAKPOINT = 880;
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

// Per-role visibility for sidebar entries.
const NAV_VISIBILITY = {
  admin:    ['dashboard','vehicles','leads','pipeline','tasks','reports','duplicates','mergePrep','marketing','billOfSale','funding','dispatch','users','company'],
  marketer: ['dashboard','leads','pipeline','marketing','reports'],
  carfax:   ['dashboard','leads','pipeline','tasks','billOfSale','funding','dispatch'],
  filter:   ['dashboard','leads','pipeline','tasks','billOfSale','funding','dispatch'],
  tlo:      ['dashboard','leads','pipeline','tasks','billOfSale','funding','dispatch'],
};
const ALL_NAV = [
  { key: 'dashboard',  label: 'Dashboard',         icon: 'home',      to: '/' },
  { key: 'vehicles',   label: 'Vehicles',          icon: 'car',       to: '/vehicles' },
  { key: 'leads',      label: 'Leads',             icon: 'users',     to: '/leads' },
  { key: 'pipeline',   label: 'Pipeline',          icon: 'pipeline',  to: '/pipeline' },
  { key: 'reports',    label: 'Reports',           icon: 'chart',     to: '/reports' },
  { key: 'tasks',      label: 'Tasks',             icon: 'check',     to: '/tasks' },
  { key: 'duplicates', label: 'Duplicate Review',  icon: 'duplicate', to: '/duplicates' },
  { key: 'mergePrep',  label: 'Merge Prep',        icon: 'merge',     to: '/merge-prep' },
  { key: 'marketing',  label: 'Marketing',         icon: 'sparkles',  to: '/marketing' },
  // Post-close pipeline: BoS → Funding → Dispatch.
  // Bill of Sale = doc list (generate + edit + sign).
  // Funding      = closed-deal pipeline view (stages, mark funded).
  // Dispatch     = transport calendar + transporter assignment.
  { key: 'billOfSale', label: 'Bill of Sale',      icon: 'file',      to: '/bill-of-sale' },
  { key: 'funding',    label: 'Funding',           icon: 'deal',      to: '/funding' },
  { key: 'dispatch',   label: 'Dispatch',          icon: 'truck',     to: '/dispatch' },
  { key: 'users',      label: 'Users',             icon: 'user',      to: '/users' },
  { key: 'company',    label: 'Company',           icon: 'building',  to: '/company-settings' },
];

const ROUTE_LABEL_BY_PATH = {
  '/':                 'Dashboard',
  '/vehicles':         'Vehicles',
  '/leads':            'CRM Leads',
  '/pipeline':         'Pipeline',
  '/reports':          'Reports',
  '/tasks':            'Tasks',
  '/duplicates':       'Duplicate Review',
  '/merge-prep':       'Merge Prep',
  '/marketing':        'Marketing',
  '/marketing/new':    'New Campaign',
  '/bill-of-sale':     'Bill of Sale',
  '/funding':          'Funding',
  '/dispatch':         'Dispatch',
  '/users':            'Users',
  '/company-settings': 'Company Settings',
  '/logs':             'Activity Logs',
};

function navItemsForRole(role) {
  const allowed = NAV_VISIBILITY[role] || NAV_VISIBILITY.admin;
  return ALL_NAV.filter((i) => allowed.includes(i.key));
}

export function Sidebar({ onSignOut, mobileOpen, onMobileClose }) {
  const { user, logout } = useAuth();
  const items = navItemsForRole(user?.role);
  const location = useLocation();

  // Auto-close on route change (mobile only)
  useEffect(() => {
    if (mobileOpen) onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  return (
    <>
      {mobileOpen && <div className="sb-backdrop" onClick={onMobileClose}/>}
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sb-brand">
          <div className="sb-logo">V</div>
          <div className="sb-brand-text">
            <span className="sb-brand-name">VINVAULT</span>
            <span className="sb-brand-sub">Internal CRM</span>
          </div>
          <button
            type="button"
            className="sb-close"
            aria-label="Close menu"
            onClick={onMobileClose}
          >
            <Icon name="x" size={18}/>
          </button>
        </div>
        <div className="sb-user">
          <Avatar name={user?.name || '?'} size={28} color="#fff" style={{ color: '#0a0a0b' }}/>
          <div className="sb-user-info">
            <span className="sb-user-name">{user?.name || 'User'}</span>
            <span className="sb-user-role">{user?.role || ''} · vin.com</span>
          </div>
        </div>

        <div className="sb-section-label">Menu</div>
        <nav className="sb-nav">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sb-link ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={16} className="sb-link-icon"/>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sb-footer">
          <div className="sb-link" onClick={() => (onSignOut ? onSignOut() : logout())}>
            <Icon name="logout" size={16} className="sb-link-icon"/>
            <span>Sign Out</span>
          </div>
        </div>
      </aside>
    </>
  );
}

export function Topbar({ onSearch, onQuickAdd, onShortcuts, onMenuToggle }) {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const isMobile = useIsMobile();
  const label = ROUTE_LABEL_BY_PATH[location.pathname]
    || (location.pathname.startsWith('/marketing/') ? 'Campaign' : 'VINVAULT');

  return (
    <div className="topbar">
      <button
        type="button"
        className="tb-icon-btn tb-menu-toggle"
        onClick={onMenuToggle}
        aria-label="Open menu"
      >
        <Icon name="list" size={18}/>
      </button>
      <div className="tb-crumbs">
        <span className="tb-crumb-root">VINVAULT</span>
        <Icon name="chevronRight" size={12} className="tb-crumb-sep"/>
        <span className="crumb-current">{label}</span>
      </div>
      <div className="tb-search" onClick={onSearch} role="button">
        <Icon name="search" size={15}/>
        <span className="tb-search-text">Search leads, vehicles, files…</span>
        <Kbd>⌘K</Kbd>
      </div>
      <div className="tb-actions">
        {!isMobile && (
          <button className="tb-icon-btn" onClick={toggle} title="Toggle theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16}/>
          </button>
        )}
        {!isMobile && (
          <button className="tb-icon-btn" onClick={onShortcuts} title="Keyboard shortcuts">
            <Icon name="keyboard" size={16}/>
          </button>
        )}
        <NotificationBellRaw tone="topbar" />
        <button className="tb-icon-btn" onClick={onQuickAdd} title="Quick add">
          <Icon name="plus" size={18}/>
        </button>
      </div>
    </div>
  );
}

export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = navItemsForRole(user?.role);
  const navItems = items.map((i) => ({ kind: 'nav', icon: i.icon, label: `Go to ${i.label}`, onClick: () => navigate(i.to) }));
  const actionItems = [
    { kind: 'action', icon: 'plus',      label: 'Add new lead',          onClick: () => navigate('/leads') },
    { kind: 'action', icon: 'upload',    label: 'Add new file',          onClick: () => navigate('/') },
    { kind: 'action', icon: 'sparkles',  label: 'New marketing campaign', onClick: () => navigate('/marketing/new') },
    { kind: 'action', icon: 'merge',     label: 'Run dedupe scan',       onClick: () => navigate('/duplicates') },
  ];

  const sections = [
    { section: 'Actions',  items: actionItems },
    { section: 'Navigate', items: navItems },
  ].map((s) => ({
    ...s,
    items: s.items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())),
  })).filter((s) => s.items.length);

  const flat = sections.flatMap((s) => s.items);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); flat[active]?.onClick(); onClose(); }
      else if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, active, flat, onClose]);

  if (!open) return null;
  let idx = -1;
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={18}/>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or search…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="cmdk-list">
          {sections.map((sec) => (
            <div key={sec.section}>
              <div className="cmdk-section-label">{sec.section}</div>
              {sec.items.map((it) => {
                idx++;
                const isActive = idx === active;
                return (
                  <div
                    key={`${sec.section}-${it.label}`}
                    className={`cmdk-item ${isActive ? 'active' : ''}`}
                    onClick={() => { it.onClick(); onClose(); }}
                    onMouseEnter={() => setActive(idx)}
                  >
                    <Icon name={it.icon} size={15}/>
                    <span>{it.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
              No results for "{q}"
            </div>
          )}
        </div>
        <div className="cmdk-foot">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> select</span>
          <span><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export function QuickAddMenu({ open, onClose }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  if (!open) return null;
  const items = [
    { icon: 'user', label: 'New lead', kbd: 'L', action: () => navigate('/leads') },
    { icon: 'car', label: 'New vehicle', kbd: 'V', action: () => navigate('/vehicles') },
    { icon: 'check', label: 'New task', kbd: 'T', action: () => navigate('/tasks') },
    { icon: 'sparkles', label: 'New campaign', kbd: 'M', action: () => navigate('/marketing/new') },
    { icon: 'upload', label: 'New file / import', kbd: 'I', action: () => navigate('/') },
  ];
  return (
    <div className="qa-menu" ref={ref}>
      {items.map((it) => (
        <div key={it.label} className="qa-item" onClick={() => { it.action(); onClose(); }}>
          <span className="qa-item-icon"><Icon name={it.icon} size={14}/></span>
          <span>{it.label}</span>
          <Kbd>{it.kbd}</Kbd>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsOverlay({ open, onClose }) {
  if (!open) return null;
  const shortcuts = [
    ['Open command palette', ['⌘', 'K']],
    ['Quick add menu', ['⌘', 'N']],
    ['Show shortcuts', ['?']],
    ['Go to Dashboard', ['G', 'D']],
    ['Go to Leads', ['G', 'L']],
    ['Go to Pipeline', ['G', 'P']],
    ['Go to Tasks', ['G', 'T']],
    ['Go to Reports', ['G', 'R']],
    ['Go to Vehicles', ['G', 'V']],
    ['Go to Marketing', ['G', 'M']],
    ['Go to Users', ['G', 'U']],
    ['Toggle theme', ['⌘', '.']],
  ];
  return (
    <div className="kbd-overlay" onClick={onClose}>
      <div className="kbd-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em' }}>Keyboard shortcuts</h3>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose}/>
        </div>
        <div className="kbd-grid">
          {shortcuts.map(([action, keys]) => (
            <div className="kbd-row" key={action}>
              <span className="kbd-action">{action}</span>
              <span className="kbd-keys">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
