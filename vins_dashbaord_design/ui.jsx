// Shared UI primitives for VINVAULT

const Icon = ({ name, size = 16, stroke = 1.6, className = "", style }) => {
  const paths = {
    home: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></>,
    car: <><path d="M5 17h14M6 17l1.5-5h9L18 17M7 12l1-3a2 2 0 012-2h4a2 2 0 012 2l1 3"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M3 19c.7-3 3.2-5 6-5s5.3 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.5 0 4.5 1.5 5 4"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.5 3.5-6 7-6s6.3 2.5 7 6"/></>,
    pipeline: <><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></>,
    deal: <><path d="M3 7h18v12H3z"/><path d="M3 11h18"/><circle cx="7" cy="15" r="1"/></>,
    chart: <><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12 16V9M16 16v-3"/></>,
    check: <><path d="M5 12l4 4 10-10"/></>,
    duplicate: <><rect x="4" y="4" width="11" height="11" rx="1"/><rect x="9" y="9" width="11" height="11" rx="1"/></>,
    merge: <><path d="M6 4v6c0 3 2 5 5 5h2c3 0 5 2 5 5v0M6 20l-2-3M6 20l2-3M18 20v-6"/></>,
    filter: <><path d="M4 5h16l-6 8v6l-4-2v-4z"/></>,
    rules: <><path d="M4 6h16M4 12h10M4 18h16"/><circle cx="18" cy="12" r="2"/></>,
    sla: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
    bell: <><path d="M6 16V11a6 6 0 0112 0v5l1 2H5z"/><path d="M10 20a2 2 0 004 0"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    plusSm: <><path d="M12 5v14M5 12h14"/></>,
    chevronDown: <><path d="M6 9l6 6 6-6"/></>,
    chevronRight: <><path d="M9 6l6 6-6 6"/></>,
    chevronLeft: <><path d="M15 6l-6 6 6 6"/></>,
    chevronUp: <><path d="M6 15l6-6 6 6"/></>,
    x: <><path d="M6 6l12 12M18 6L6 18"/></>,
    more: <><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></>,
    moreV: <><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></>,
    download: <><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></>,
    upload: <><path d="M12 20V8"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></>,
    folder: <><path d="M3 6a1 1 0 011-1h4l2 2h10a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 7 9-7"/></>,
    phone: <><path d="M5 4h3l2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2v3c0 1-1 2-2 2C9 20 4 15 4 6c0-1 1-2 2-2z"/></>,
    sms: <><path d="M4 5h16v12H8l-4 4z"/></>,
    play: <><path d="M6 4l14 8-14 8z"/></>,
    pause: <><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></>,
    star: <><path d="M12 3l2.7 6 6.3.6-4.8 4.4 1.5 6.4L12 17l-5.7 3.4 1.5-6.4L3 9.6 9.3 9z"/></>,
    starFill: <><path d="M12 3l2.7 6 6.3.6-4.8 4.4 1.5 6.4L12 17l-5.7 3.4 1.5-6.4L3 9.6 9.3 9z" fill="currentColor"/></>,
    bookmark: <><path d="M6 4h12v17l-6-4-6 4z"/></>,
    columns: <><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="4" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></>,
    logout: <><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4"/><path d="M16 8l4 4-4 4"/><path d="M20 12H10"/></>,
    flag: <><path d="M5 4v16M5 4h12l-2 4 2 4H5"/></>,
    fire: <><path d="M12 3c1 4 6 5 6 11a6 6 0 11-12 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-7 2-10z"/></>,
    snow: <><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></>,
    cmd: <><path d="M9 3a3 3 0 100 6h6a3 3 0 100-6 3 3 0 00-3 3v12a3 3 0 11-3-3h6a3 3 0 113 3"/></>,
    arrowRight: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    arrowDown: <><path d="M12 5v14M18 13l-6 6-6-6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></>,
    moon: <><path d="M20 14A8 8 0 0110 4a8 8 0 1010 10z"/></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16z"/><path d="M14 5l4 4"/></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></>,
    link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></>,
    refresh: <><path d="M20 11a8 8 0 10-2.5 7.5"/><path d="M20 4v7h-7"/></>,
    keyboard: <><rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 10v0M10 10v0M14 10v0M18 10v0M6 14h12"/></>,
    activity: <><path d="M3 12h4l3-9 4 18 3-9h4"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    tag: <><path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="8" r="1.5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 8v0M12 11v5"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></>,
    sparkles: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 16l.7 2 2 .7-2 .7L19 21l-.7-1.6-2-.7 2-.7z"/></>,
    bolt: <><path d="M13 3L4 14h7l-1 7 9-11h-7z"/></>,
    spinner: <><circle cx="12" cy="12" r="9" strokeOpacity=".2"/><path d="M21 12a9 9 0 00-9-9"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      {paths[name] || null}
    </svg>
  );
};

// Tier dot
const TierDot = ({ tier }) => {
  const colors = { T1: "var(--tier1)", T2: "var(--tier2)", T3: "var(--tier3)" };
  return (
    <span className="tier-pill">
      <span className="tier-dot" style={{ background: colors[tier] }}/>
      {tier}
    </span>
  );
};

// Status badge
const StatusBadge = ({ status }) => {
  const map = {
    "New": "info",
    "Contacted": "neutral",
    "Callback": "warn",
    "Interested": "success",
    "Not interested": "muted",
    "Wrong number": "muted",
    "No answer": "muted",
    "Voicemail left": "neutral",
    "Deal closed": "success",
    "Nurture": "info",
    "Disqualified": "muted",
    "Do not call": "danger",
    "Marketing": "info",
    "Complete": "success",
    "Processing": "info",
    "Filtering": "warn",
    "Carfax": "neutral",
    "Generated": "neutral",
    "Active": "success",
    "Scheduled": "info",
    "Completed": "muted",
    "Draft": "muted",
    "Sold": "success",
    "Acquired": "info",
    "Open": "neutral",
    "Confirmed": "success",
    "Pending": "warn",
    "Ignored": "muted",
  };
  const variant = map[status] || "neutral";
  return <span className={`status-badge sb-${variant}`}>{status}</span>;
};

// Temperature pill
const TempPill = ({ temp }) => {
  const map = {
    "Hot":     { c: "var(--hot)", icon: "fire" },
    "Warm":    { c: "var(--warm)", icon: null },
    "Cold":    { c: "var(--cold)", icon: null },
    "No answer": { c: "var(--muted-fg)", icon: null },
    "Closed":  { c: "var(--text-2)", icon: null },
  };
  const t = map[temp] || map["Cold"];
  if (!temp || temp === "—") return <span className="temp-pill empty">— Not set —</span>;
  return (
    <span className="temp-pill" style={{ color: t.c }}>
      <span className="temp-dot" style={{ background: t.c }}/>
      {temp}
    </span>
  );
};

// Priority chip
const PriorityChip = ({ priority }) => {
  if (!priority || priority === "—") return <span className="priority-chip empty">—</span>;
  return <span className={`priority-chip pc-${priority.toLowerCase()}`}>{priority}</span>;
};

// Avatar
const Avatar = ({ name, size = 24, color }) => {
  const initial = (name || "?").split(" ").map(s => s[0]).slice(0,2).join("").toUpperCase();
  // Hash to color
  let h = 0; for (const ch of (name||"x")) h = (h*31 + ch.charCodeAt(0)) | 0;
  const palette = ["#1f1f23","#2c2c30","#3a3a3f","#4a4a4f","#5a5a5f"];
  const bg = color || palette[Math.abs(h) % palette.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, fontSize: Math.round(size*0.42) }}>
      {initial}
    </span>
  );
};

// Generic button
const Button = ({ variant = "secondary", size = "md", children, icon, iconAfter, onClick, type, disabled, ...rest }) => {
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant} btn-${size}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16}/>}
      {children}
      {iconAfter && <Icon name={iconAfter} size={size === "sm" ? 14 : 16}/>}
    </button>
  );
};

// Kbd
const Kbd = ({ children }) => <kbd className="kbd">{children}</kbd>;

// Input
const Input = ({ icon, ...rest }) => (
  <div className="input-wrap">
    {icon && <Icon name={icon} size={15} className="input-icon"/>}
    <input className={`input ${icon ? "has-icon" : ""}`} {...rest}/>
  </div>
);

// Stage dots (4-step pipeline)
const StageDots = ({ stages }) => (
  <span className="stage-dots">
    {stages.map((s, i) => (
      <React.Fragment key={i}>
        <span className={`stage-dot ${s ? "done" : ""}`}/>
        {i < stages.length - 1 && <span className={`stage-line ${stages[i+1] ? "done" : ""}`}/>}
      </React.Fragment>
    ))}
  </span>
);

// Pipeline mini bar (for dashboard file row)
const PipelineMini = ({ stages, labels }) => (
  <div className="pipeline-mini">
    {stages.map((s, i) => (
      <span key={i} className={`pm-step ${s ? "done" : ""}`}>
        <span className="pm-dot"/>
        {labels && <span className="pm-label">{labels[i]}</span>}
      </span>
    ))}
  </div>
);

// Section header
const SectionHeader = ({ title, subtitle, actions }) => (
  <div className="section-header">
    <div>
      <h1 className="section-title">{title}</h1>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="section-actions">{actions}</div>}
  </div>
);

// KPI card
const KPI = ({ label, value, hint, dot, trend, trendDir, accent, large }) => (
  <div className={`kpi ${large ? "kpi-lg" : ""}`}>
    <div className="kpi-label">{label}</div>
    <div className="kpi-value-row">
      <div className="kpi-value">{value}</div>
      {dot && <span className="kpi-dot" style={{ background: dot }}/>}
      {trend !== undefined && (
        <span className={`kpi-trend ${trendDir === "up" ? "up" : trendDir === "down" ? "down" : ""}`}>
          {trendDir === "up" ? "↑" : trendDir === "down" ? "↓" : ""} {trend}
        </span>
      )}
    </div>
    {hint && <div className="kpi-hint">{hint}</div>}
  </div>
);

// Dropdown menu (uncontrolled)
const Dropdown = ({ trigger, items, align = "left" }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="dropdown-wrap" ref={ref}>
      <span onClick={() => setOpen(o => !o)}>{trigger}</span>
      {open && (
        <div className={`dropdown-menu align-${align}`}>
          {items.map((it, i) => (
            it.divider
              ? <div key={i} className="dd-divider"/>
              : <button key={i} className="dd-item" onClick={() => { it.onClick && it.onClick(); setOpen(false); }}>
                  {it.icon && <Icon name={it.icon} size={14}/>}
                  <span>{it.label}</span>
                  {it.kbd && <span className="dd-kbd"><Kbd>{it.kbd}</Kbd></span>}
                </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Empty state
const EmptyState = ({ icon, title, body, action }) => (
  <div className="empty-state">
    {icon && <div className="empty-icon"><Icon name={icon} size={28}/></div>}
    <div className="empty-title">{title}</div>
    {body && <div className="empty-body">{body}</div>}
    {action}
  </div>
);

Object.assign(window, {
  Icon, TierDot, StatusBadge, TempPill, PriorityChip, Avatar, Button, Kbd, Input,
  StageDots, PipelineMini, SectionHeader, KPI, Dropdown, EmptyState,
});
