// Shell: Sidebar, Topbar, CommandPalette, Notifications, QuickAdd, Shortcuts overlay

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "home" },
  { key: "vehicles", label: "Vehicles", icon: "car" },
  { key: "leads", label: "Leads", icon: "users", count: 84 },
  { key: "pipeline", label: "Pipeline", icon: "pipeline" },
  { key: "deals", label: "Deals", icon: "deal" },
  { key: "reports", label: "Reports", icon: "chart" },
  { key: "tasks", label: "Tasks", icon: "check", count: 7 },
  { key: "duplicate", label: "Duplicate Review", icon: "duplicate" },
  { key: "merge", label: "Merge Prep", icon: "merge" },
  { key: "filterReview", label: "Filter Review", icon: "filter" },
  { key: "marketing", label: "Marketing", icon: "sparkles" },
  { key: "filterRules", label: "Filter Rules", icon: "rules" },
  { key: "sla", label: "SLA Rules", icon: "sla" },
  { key: "users", label: "Users", icon: "user" },
];

const Sidebar = ({ route, setRoute, onSignOut }) => {
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo">V</div>
        <div className="sb-brand-text">
          <span className="sb-brand-name">VINVAULT</span>
          <span className="sb-brand-sub">Internal CRM</span>
        </div>
      </div>
      <div className="sb-user">
        <Avatar name="Admin" size={28} color="#fff" style={{ color: "#0a0a0b" }}/>
        <div className="sb-user-info">
          <span className="sb-user-name">Admin</span>
          <span className="sb-user-role">admin · vin.com</span>
        </div>
        <span className="sb-bell">
          <Icon name="bell" size={15}/>
          <span className="bell-dot"/>
        </span>
      </div>
      <div className="sb-section-label">Menu</div>
      <nav className="sb-nav">
        {NAV_ITEMS.map(item => (
          <div
            key={item.key}
            className={`sb-link ${route === item.key ? "active" : ""}`}
            onClick={() => setRoute(item.key)}
          >
            <Icon name={item.icon} size={16} className="sb-link-icon"/>
            <span>{item.label}</span>
            {item.count !== undefined && <span className="sb-link-count">{item.count}</span>}
          </div>
        ))}
      </nav>
      <div className="sb-footer">
        <div className="sb-link" onClick={onSignOut}>
          <Icon name="logout" size={16} className="sb-link-icon"/>
          <span>Sign Out</span>
        </div>
      </div>
    </aside>
  );
};

const Avatar = window.Avatar; // re-bind safety

const ROUTE_LABELS = Object.fromEntries(NAV_ITEMS.map(i => [i.key, i.label]));

const Topbar = ({ route, onSearch, onQuickAdd, onNotifs, onShortcuts, theme, toggleTheme }) => {
  return (
    <div className="topbar">
      <div className="tb-crumbs">
        <span>VINVAULT</span>
        <Icon name="chevronRight" size={12} className="tb-crumb-sep"/>
        <span className="crumb-current">{ROUTE_LABELS[route] || "Dashboard"}</span>
      </div>
      <div className="tb-search" onClick={onSearch} role="button">
        <Icon name="search" size={15}/>
        <span className="tb-search-text">Search leads, vehicles, files…</span>
        <Kbd>⌘K</Kbd>
      </div>
      <div className="tb-actions">
        <button className="tb-icon-btn" onClick={toggleTheme} title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16}/>
        </button>
        <button className="tb-icon-btn" onClick={onShortcuts} title="Keyboard shortcuts">
          <Icon name="keyboard" size={16}/>
        </button>
        <button className="tb-icon-btn" onClick={onNotifs} title="Notifications">
          <Icon name="bell" size={16}/>
          <span className="dot"/>
        </button>
        <button className="tb-icon-btn" onClick={onQuickAdd} title="Quick add">
          <Icon name="plus" size={18}/>
        </button>
      </div>
    </div>
  );
};

const CommandPalette = ({ open, onClose, setRoute, openLead }) => {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const navItems = NAV_ITEMS.map(i => ({ kind: "nav", icon: i.icon, label: `Go to ${i.label}`, onClick: () => setRoute(i.key) }));
  const actionItems = [
    { kind: "action", icon: "plus", label: "Add new lead", onClick: () => {} },
    { kind: "action", icon: "upload", label: "Import VIN file", onClick: () => {} },
    { kind: "action", icon: "sparkles", label: "Create marketing campaign", onClick: () => setRoute("marketing") },
    { kind: "action", icon: "merge", label: "Run dedupe scan", onClick: () => setRoute("duplicate") },
  ];
  const leadItems = window.VINDATA.LEADS.slice(0,8).map(l => ({
    kind: "lead", icon: "user", label: l.name, meta: l.vehicle, onClick: () => openLead(l)
  }));

  const all = [
    { section: "Actions", items: actionItems },
    { section: "Navigate", items: navItems },
    { section: "Leads", items: leadItems },
  ].map(s => ({ ...s, items: s.items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase()) || (i.meta||"").toLowerCase().includes(q.toLowerCase())) })).filter(s => s.items.length);

  const flat = all.flatMap(s => s.items);

  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a+1, flat.length-1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a-1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); flat[active]?.onClick(); onClose(); }
      else if (e.key === "Escape") { onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active, flat, onClose]);

  if (!open) return null;
  let idx = -1;
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={18}/>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or search…"
            value={q}
            onChange={e => { setQ(e.target.value); setActive(0); }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="cmdk-list">
          {all.map((sec) => (
            <div key={sec.section}>
              <div className="cmdk-section-label">{sec.section}</div>
              {sec.items.map(it => {
                idx++;
                const isActive = idx === active;
                return (
                  <div
                    key={`${sec.section}-${it.label}`}
                    className={`cmdk-item ${isActive ? "active" : ""}`}
                    onClick={() => { it.onClick(); onClose(); }}
                    onMouseEnter={() => setActive(idx)}
                  >
                    <Icon name={it.icon} size={15}/>
                    <span>{it.label}</span>
                    {it.meta && <span className="cmdk-item-meta">{it.meta}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div style={{ padding: "30px", textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>
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
};

const NotificationsPopover = ({ open, onClose }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  const iconMap = { lead: "user", task: "check", deal: "deal", system: "bolt" };
  return (
    <div className="popover" ref={ref}>
      <div className="popover-head">
        <span className="popover-title">Notifications</span>
        <Button variant="ghost" size="sm">Mark all read</Button>
      </div>
      <div className="popover-list">
        {window.VINDATA.NOTIFICATIONS.map(n => (
          <div key={n.id} className="notif-item">
            <span className="notif-icon"><Icon name={iconMap[n.type]} size={14}/></span>
            <div>
              <div className="notif-title">{n.title}</div>
              <div className="notif-body">{n.body}</div>
            </div>
            <span className="notif-time">{n.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const QuickAddMenu = ({ open, onClose, setRoute }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  if (!open) return null;
  const items = [
    { icon: "user", label: "New lead", kbd: "L", action: () => setRoute("leads") },
    { icon: "car", label: "New vehicle", kbd: "V", action: () => setRoute("vehicles") },
    { icon: "check", label: "New task", kbd: "T", action: () => setRoute("tasks") },
    { icon: "deal", label: "New deal", kbd: "D", action: () => setRoute("deals") },
    { icon: "sparkles", label: "New campaign", kbd: "M", action: () => setRoute("marketing") },
    { icon: "upload", label: "Import VIN file", kbd: "I", action: () => setRoute("dashboard") },
  ];
  return (
    <div className="qa-menu" ref={ref}>
      {items.map(it => (
        <div key={it.label} className="qa-item" onClick={() => { it.action(); onClose(); }}>
          <span className="qa-item-icon"><Icon name={it.icon} size={14}/></span>
          <span>{it.label}</span>
          <Kbd>{it.kbd}</Kbd>
        </div>
      ))}
    </div>
  );
};

const ShortcutsOverlay = ({ open, onClose }) => {
  if (!open) return null;
  const shortcuts = [
    ["Open command palette", ["⌘", "K"]],
    ["Quick add menu", ["⌘", "N"]],
    ["Show shortcuts", ["?"]],
    ["Toggle sidebar", ["⌘", "\\"]],
    ["Go to Dashboard", ["G", "D"]],
    ["Go to Leads", ["G", "L"]],
    ["Go to Pipeline", ["G", "P"]],
    ["Go to Tasks", ["G", "T"]],
    ["Go to Reports", ["G", "R"]],
    ["Filter table", ["F"]],
    ["Search current view", ["/"]],
    ["Toggle theme", ["⌘", "."]],
  ];
  return (
    <div className="kbd-overlay" onClick={onClose}>
      <div className="kbd-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, letterSpacing: "-0.02em" }}>Keyboard shortcuts</h3>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose}/>
        </div>
        <div className="kbd-grid">
          {shortcuts.map(([action, keys]) => (
            <div className="kbd-row" key={action}>
              <span className="kbd-action">{action}</span>
              <span className="kbd-keys">{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { Sidebar, Topbar, CommandPalette, NotificationsPopover, QuickAddMenu, ShortcutsOverlay, NAV_ITEMS });
