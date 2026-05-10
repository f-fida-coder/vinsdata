import { useState, useEffect, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { Icon, Avatar, Button, EmptyState } from '../components/ui';

const ROLES = [
  { key: 'admin',    label: 'Admin',    tone: 'accent', hint: 'Full access. Can manage users, files, leads, marketing.' },
  { key: 'carfax',   label: 'Carfax',   tone: 'warm',   hint: 'Can move files through the Carfax stage.' },
  { key: 'filter',   label: 'Filter',   tone: 'cold',   hint: 'Can move files through the Filter stage.' },
  { key: 'tlo',      label: 'TLO',      tone: 'success', hint: 'Can move files through the TLO stage.' },
  { key: 'marketer', label: 'Marketer', tone: 'info',   hint: 'Can build segments and run marketing campaigns.' },
];
const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));

const TONE_VAR = {
  accent: 'var(--accent)',
  info:   'var(--info)',
  warm:   'var(--warm)',
  cold:   'var(--cold)',
  hot:    'var(--hot)',
  danger: 'var(--danger)',
  success: 'var(--success)',
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function HeroTile({ label, value, icon, tone }) {
  const color = TONE_VAR[tone] || 'var(--text-1)';
  return (
    <div className="us-tile" style={{ '--tile-color': color }}>
      <span className="us-tile-icon"><Icon name={icon} size={16}/></span>
      <span className="us-tile-body">
        <span className="us-tile-label">{label}</span>
        <span className="us-tile-value">{Number(value || 0).toLocaleString()}</span>
      </span>
    </div>
  );
}

function RolePill({ roleKey }) {
  const meta = ROLE_BY_KEY[roleKey];
  if (!meta) return <span className="us-role us-role-default">{roleKey || 'unknown'}</span>;
  const color = TONE_VAR[meta.tone];
  return (
    <span className="us-role" style={{ '--role-color': color }}>
      <span className="us-role-dot"/>
      {meta.label}
    </span>
  );
}

// Right-side drawer for adding/editing a user. Keeps everything (profile, role,
// password) in one place rather than two tiny dialogs.
function UserDrawer({ open, mode, initial, onClose, onSubmit, onDelete, isSelf, submitting, error }) {
  const [form, setForm] = useState(initial);
  const [pwSection, setPwSection] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    setForm(initial);
    setPwSection(mode === 'create');
    setShowPw(false);
  }, [open, initial, mode]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  const generatePassword = () => {
    // Mnemonic-ish: three syllables + 2 digits. Easy enough to read aloud, hard to guess.
    const syllables = ['lo','ra','vi','ko','su','re','ta','mi','no','pa','xe','zi','tu','va','de','no','ja','ki'];
    const pick = () => syllables[Math.floor(Math.random() * syllables.length)];
    const pwd = pick() + pick() + pick() + Math.floor(10 + Math.random() * 90);
    setForm((f) => ({ ...f, password: pwd }));
    setShowPw(true);
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <aside className="drawer us-drawer">
        <div className="drawer-head">
          <div>
            <div className="drawer-section-label" style={{ marginBottom: 4 }}>{mode === 'create' ? 'New user' : 'Edit user'}</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
              {mode === 'create' ? 'Add a team member' : (form.name || 'User')}
            </h2>
          </div>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose}/>
        </div>

        <form className="drawer-body" onSubmit={submit} id="user-drawer-form" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div className="us-alert">
              <Icon name="info" size={14}/>
              <span>{error}</span>
            </div>
          )}

          <section className="us-section">
            <div className="us-section-head">
              <Icon name="user" size={14}/>
              <span>Profile</span>
            </div>
            <div className="us-fields">
              <div>
                <label className="field-label">Full name</label>
                <input
                  className="vv-input"
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="Jane Doe"
                />
              </div>
              <div className="us-fields-row">
                <div style={{ flex: 1 }}>
                  <label className="field-label">Email</label>
                  <input
                    className="vv-input"
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    placeholder="jane@vin.com"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Phone (WhatsApp)</label>
                  <input
                    className="vv-input"
                    type="text"
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+923213531295"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="us-section">
            <div className="us-section-head">
              <Icon name="settings" size={14}/>
              <span>Role &amp; access</span>
            </div>
            <div className="us-roles">
              {ROLES.map((r) => {
                const active = form.role === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    className={`us-role-card ${active ? 'is-active' : ''}`}
                    onClick={() => setForm({ ...form, role: r.key })}
                    style={{ '--role-color': TONE_VAR[r.tone] }}
                  >
                    <div className="us-role-card-head">
                      <span className="us-role-card-dot"/>
                      <span className="us-role-card-name">{r.label}</span>
                      {active && <Icon name="check" size={12} className="us-role-card-check"/>}
                    </div>
                    <div className="us-role-card-hint">{r.hint}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="us-section">
            <div className="us-section-head us-section-head-toggleable">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="bolt" size={14}/>
                <span>{mode === 'create' ? 'Password' : 'Reset password'}</span>
              </span>
              {mode === 'edit' && (
                <button type="button" className="us-section-toggle" onClick={() => setPwSection((v) => !v)}>
                  {pwSection ? 'Cancel' : 'Change password'}
                </button>
              )}
            </div>
            {(pwSection || mode === 'create') && (
              <div className="us-fields">
                <div>
                  <label className="field-label">{mode === 'create' ? 'Password' : 'New password'}</label>
                  <div className="us-pw-wrap">
                    <input
                      className="vv-input"
                      type={showPw ? 'text' : 'password'}
                      value={form.password || ''}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required={mode === 'create'}
                      minLength={6}
                      placeholder={mode === 'create' ? 'At least 6 characters' : 'Leave blank to keep the current one'}
                      autoComplete="new-password"
                    />
                    <div className="us-pw-actions">
                      <button type="button" className="us-pw-btn" onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'}>
                        <Icon name={showPw ? 'eye' : 'eye'} size={14}/>
                      </button>
                      <button type="button" className="us-pw-btn" onClick={generatePassword} title="Generate">
                        <Icon name="sparkles" size={14}/>
                      </button>
                    </div>
                  </div>
                  <div className="us-pw-hint">
                    {mode === 'create'
                      ? 'Share the password with the user securely. They can change it after first sign-in.'
                      : 'You\'re resetting the password as an admin — the user will need this new one to sign in.'}
                  </div>
                </div>
              </div>
            )}
          </section>
        </form>

        <div className="drawer-foot">
          {mode === 'edit' && !isSelf && (
            <Button variant="danger" icon="trash" onClick={onDelete} style={{ marginRight: 'auto' }}>Delete user</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="user-drawer-form" disabled={submitting}>
            {submitting ? 'Saving…' : (mode === 'create' ? 'Add user' : 'Save changes')}
          </Button>
        </div>
      </aside>
    </>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState(null); // null | { mode, initial }
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try { const res = await api.get('/users'); setUsers(res.data); }
    catch { setError('Failed to load users'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q)
        || (u.phone || '').toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  const counts = useMemo(() => {
    const out = { total: users.length };
    for (const r of ROLES) out[r.key] = users.filter((u) => u.role === r.key).length;
    return out;
  }, [users]);

  if (user.role !== 'admin') {
    return (
      <div className="page">
        <EmptyState icon="info" title="Access Denied" body="This page is restricted to admins."/>
      </div>
    );
  }

  const openCreate = () => {
    setDrawerError('');
    setDrawer({ mode: 'create', initial: { name: '', email: '', phone: '', password: '', role: 'admin' } });
  };
  const openEdit = (u) => {
    setDrawerError('');
    setDrawer({ mode: 'edit', initial: { id: u.id, name: u.name, email: u.email, phone: u.phone || '', password: '', role: u.role } });
  };

  const submitDrawer = async (form) => {
    setSubmitting(true); setDrawerError('');
    try {
      if (drawer.mode === 'create') {
        await api.post('/users', form);
      } else {
        const payload = {
          id: form.id, name: form.name, email: form.email,
          phone: form.phone || null, role: form.role,
        };
        if (form.password) payload.password = form.password;
        await api.patch('/users', payload);
      }
      setDrawer(null);
      fetchUsers();
    } catch (err) {
      setDrawerError(extractApiError(err, 'Failed to save user'));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteUser = async () => {
    if (!drawer || drawer.mode !== 'edit') return;
    const id = drawer.initial.id;
    if (!window.confirm(`Delete ${drawer.initial.name}? This cannot be undone.`)) return;
    try {
      await api.delete('/users', { data: { id } });
      setDrawer(null);
      fetchUsers();
    } catch (err) {
      setDrawerError(extractApiError(err, 'Failed to delete user'));
    }
  };

  return (
    <div className="page users-page">
      <div className="us-header">
        <div>
          <h1 className="section-title">Users</h1>
          <p className="section-subtitle">Team members and their roles · admins manage everything · agents see only their leads</p>
        </div>
        <Button variant="primary" icon="plus" onClick={openCreate}>Add user</Button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      )}

      {/* Hero tiles */}
      <div className="us-hero">
        <HeroTile label="Total" value={counts.total} icon="users" tone="accent"/>
        <HeroTile label="Admins" value={counts.admin} icon="user" tone="info"/>
        <HeroTile label="Carfax" value={counts.carfax} icon="folder" tone="warm"/>
        <HeroTile label="Filter" value={counts.filter} icon="filter" tone="cold"/>
        <HeroTile label="TLO" value={counts.tlo} icon="check" tone="success"/>
      </div>

      <div className="us-toolbar">
        <div className="vv-input-wrap" style={{ flex: 1, maxWidth: 360 }}>
          <Icon name="search" size={15} className="vv-input-icon"/>
          <input
            type="text"
            className="vv-input has-icon"
            placeholder="Search by name, email, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="us-rolefilter">
          <button
            type="button"
            className={`us-rolechip ${!roleFilter ? 'is-active' : ''}`}
            onClick={() => setRoleFilter('')}
          >
            All
          </button>
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`us-rolechip ${roleFilter === r.key ? 'is-active' : ''}`}
              onClick={() => setRoleFilter(roleFilter === r.key ? '' : r.key)}
              style={{ '--role-color': TONE_VAR[r.tone] }}
            >
              <span className="us-role-dot"/>
              {r.label}
              <span className="us-rolechip-count">{counts[r.key] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="us-card">
        {loading ? (
          <div className="us-loading">
            <div className="vv-spinner"/>
            <p>Loading users…</p>
          </div>
        ) : filtered.length === 0 ? (
          users.length === 0 ? (
            <div className="tk-empty">
              <div className="tk-empty-icon"><Icon name="users" size={28}/></div>
              <h3 className="tk-empty-title">No users yet</h3>
              <p className="tk-empty-body">Add your first team member to get started.</p>
              <Button variant="primary" icon="plus" onClick={openCreate} style={{ marginTop: 8 }}>Add user</Button>
            </div>
          ) : (
            <div className="tk-empty">
              <div className="tk-empty-icon" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}><Icon name="search" size={28}/></div>
              <h3 className="tk-empty-title">No matches</h3>
              <p className="tk-empty-body">Try a different search or clear the role filter.</p>
            </div>
          )
        ) : (
          <div className="us-list">
            <div className="us-list-head">
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Role</span>
              <span>Created</span>
              <span/>
            </div>
            {filtered.map((u) => (
              <div key={u.id} className="us-row" onClick={() => openEdit(u)}>
                <div className="us-row-name">
                  <Avatar name={u.name} size={32}/>
                  <div className="us-row-name-body">
                    <span className="us-row-name-text">{u.name}</span>
                    {Number(u.id) === Number(user?.id) && <span className="us-row-you">you</span>}
                  </div>
                </div>
                <div className="us-row-email">{u.email}</div>
                <div className="us-row-phone">{u.phone ? <span className="cell-mono">{u.phone}</span> : <span className="us-row-empty">—</span>}</div>
                <div><RolePill roleKey={u.role}/></div>
                <div className="us-row-date">{formatDate(u.created_at)}</div>
                <div className="us-row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => openEdit(u)}>Edit</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <UserDrawer
        open={!!drawer}
        mode={drawer?.mode}
        initial={drawer?.initial || {}}
        isSelf={drawer?.mode === 'edit' && Number(drawer?.initial?.id) === Number(user?.id)}
        submitting={submitting}
        error={drawerError}
        onClose={() => setDrawer(null)}
        onSubmit={submitDrawer}
        onDelete={deleteUser}
      />
    </div>
  );
}
