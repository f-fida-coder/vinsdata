// Pages: Duplicate Review, Merge Prep, Filter Review, Filter Rules, SLA Rules, Marketing, Users

const DuplicateReview = ({ openLead }) => {
  const { DUPLICATE_GROUPS, LEADS } = window.VINDATA;
  return (
    <div className="page">
      <SectionHeader
        title="Duplicate Review"
        subtitle="Confirm or dismiss potential duplicates · confirmed groups move to Merge Prep"
        actions={<Button variant="primary" icon="refresh">Run dedupe scan</Button>}
      />
      <div className="kpi-row">
        <KPI label="Pending" value="2" dot="var(--warm)"/>
        <KPI label="Confirmed" value="2" dot="var(--success)"/>
        <KPI label="Not duplicate" value="0" dot="var(--text-3)"/>
        <KPI label="Ignored" value="1" dot="var(--text-3)"/>
        <KPI label="Auto-confidence ≥ 90%" value="3" dot="var(--cold)"/>
      </div>
      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <Button variant="secondary" icon="filter">Filters</Button>
          <span className="cell-muted">Showing 5 groups</span>
        </div>
        <table className="tbl">
          <thead><tr>
            <th className="tbl-checkbox"><input type="checkbox"/></th>
            <th>Match type</th><th>Confidence</th><th>Members</th><th>Key</th><th>Status</th><th>Primary</th><th>Reviewed by</th><th></th>
          </tr></thead>
          <tbody>
            {DUPLICATE_GROUPS.map(g => (
              <tr key={g.id}>
                <td className="tbl-checkbox" onClick={e => e.stopPropagation()}><input type="checkbox"/></td>
                <td className="cell-strong">{g.matchType}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="bar-track" style={{ width: 80, height: 6 }}><span className="bar-fill" style={{ width: `${g.confidence*100}%`, background: g.confidence > 0.9 ? "var(--success)" : "var(--warn)" }}/></span>
                    <span className="cell-mono">{Math.round(g.confidence*100)}%</span>
                  </div>
                </td>
                <td>{g.members}</td>
                <td className="cell-mono">{g.key}</td>
                <td><StatusBadge status={g.status}/></td>
                <td className="cell-muted">{g.primary}</td>
                <td className="cell-muted">{g.preparedBy}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <Button variant="secondary" size="sm" icon="eye">Review</Button>
                    {g.status === "Pending" && <Button variant="primary" size="sm" icon="check">Confirm</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MergePrep = () => {
  return (
    <div className="page">
      <SectionHeader
        title="Merge Prep"
        subtitle="2 confirmed groups · non-destructive workspace · choose primary record and merge fields"
        actions={<Button variant="primary" icon="check">Apply merges (2)</Button>}
      />
      <div className="kpi-row">
        <KPI label="Confirmed Groups" value="2" dot="var(--success)"/>
        <KPI label="Not Started" value="0" dot="var(--text-3)"/>
        <KPI label="Draft" value="1" dot="var(--warm)"/>
        <KPI label="Prepared" value="1" dot="var(--success)"/>
        <KPI label="Prepared by Me" value="1" dot="var(--cold)"/>
      </div>
      <div className="filters-row">
        <div className="filters-label"><Icon name="filter" size={14}/> Filters</div>
        <select className="input" style={{width:140}}><option>Any status</option></select>
        <select className="input" style={{width:140}}><option>Any preparer</option></select>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Match type</th><th>Confidence</th><th>Members</th><th>Key</th><th>Prep status</th><th>Preferred primary</th><th>Prepared by</th><th></th></tr></thead>
          <tbody>
            <tr>
              <td className="cell-strong">Email</td>
              <td><span className="cell-mono">92%</span></td>
              <td>2</td>
              <td className="cell-mono">kharam67@gmail.com</td>
              <td><StatusBadge status="Pending"/></td>
              <td>Miles Austin</td>
              <td><div className="row"><Avatar name="Carfax1" size={20}/><span style={{fontSize:12}}>Carfax1</span></div></td>
              <td><Button variant="primary" size="sm">Open</Button></td>
            </tr>
            <tr>
              <td className="cell-strong">VIN</td>
              <td><span className="cell-mono">100%</span></td>
              <td>2</td>
              <td className="cell-mono">1FTYR10D...7B14</td>
              <td><StatusBadge status="Confirmed"/></td>
              <td>Roman Telluride</td>
              <td><div className="row"><Avatar name="Saad" size={20}/><span style={{fontSize:12}}>Saad</span></div></td>
              <td><Button variant="secondary" size="sm">View</Button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const FilterReview = () => {
  return (
    <div className="page">
      <SectionHeader
        title="Filter Review"
        subtitle="Records flagged or dropped by automated filter rules · review and override"
        actions={<><Button variant="ghost" icon="rules">View rules</Button><Button variant="primary" icon="check">Approve all</Button></>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KPI label="Flagged" value="84" dot="var(--warm)"/>
        <KPI label="Auto-dropped" value="412" dot="var(--text-3)"/>
        <KPI label="Reviewed today" value="36"/>
        <KPI label="Override rate" value="6.2%"/>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Lead</th><th>Rule triggered</th><th>Reason</th><th>Source file</th><th>Suggested action</th><th></th></tr></thead>
          <tbody>
            {window.VINDATA.LEADS.slice(0,8).map(l => (
              <tr key={l.id}>
                <td><div className="lead-cell"><div className="lead-name">{l.name}</div><div className="lead-vehicle">{l.vehicle}</div></div></td>
                <td><span className="status-badge sb-warn">Skip duplicates by VIN</span></td>
                <td className="cell-muted">VIN matched lead L-1042</td>
                <td className="cell-mono tiny">{l.sourceFile}</td>
                <td><span className="status-badge sb-muted">Drop</span></td>
                <td><div className="row" style={{ gap: 4 }}><Button variant="secondary" size="sm" icon="check">Keep</Button><Button variant="ghost" size="sm" icon="x">Drop</Button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const FilterRules = () => {
  const { FILTER_RULES } = window.VINDATA;
  return (
    <div className="page">
      <SectionHeader
        title="Filter Rules"
        subtitle="Automated filters applied at each enrichment stage · drag to reorder priority"
        actions={<Button variant="primary" icon="plus">New rule</Button>}
      />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Name</th><th>Scope</th><th>Active</th><th>Hits (30d)</th><th></th></tr></thead>
          <tbody>
            {FILTER_RULES.map(r => (
              <tr key={r.id}>
                <td className="cell-mono">{r.priority}</td>
                <td className="cell-strong">{r.name}</td>
                <td className="cell-muted">{r.scope}</td>
                <td>{r.active ? <StatusBadge status="Active"/> : <StatusBadge status="Draft"/>}</td>
                <td>{r.hits.toLocaleString()}</td>
                <td><div className="row" style={{ gap: 4 }}><Button variant="ghost" size="sm" icon="edit">Edit</Button><Button variant="ghost" size="sm" icon="copy"/></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SLA = () => {
  const { SLA_RULES } = window.VINDATA;
  return (
    <div className="page">
      <SectionHeader
        title="SLA Rules"
        subtitle="Response-time targets and breach actions · keep hot leads warm"
        actions={<Button variant="primary" icon="plus">New SLA</Button>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KPI label="On track" value="94%" dot="var(--success)"/>
        <KPI label="At risk" value="12" dot="var(--warm)"/>
        <KPI label="Breached (7d)" value="15" dot="var(--hot)"/>
        <KPI label="Avg first-touch" value="2h 14m"/>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Rule</th><th>Target</th><th>Scope</th><th>Breach action</th><th>Breaches (7d)</th><th></th></tr></thead>
          <tbody>
            {SLA_RULES.map(r => (
              <tr key={r.id}>
                <td className="cell-strong">{r.name}</td>
                <td><span className="status-badge sb-info">{r.target}</span></td>
                <td className="cell-mono tiny">{r.scope}</td>
                <td className="cell-muted">{r.breachAction}</td>
                <td><span style={{ color: r.breaches7d > 5 ? "var(--danger)" : "var(--text-1)", fontWeight: 500 }}>{r.breaches7d}</span></td>
                <td><Button variant="ghost" size="sm" icon="edit">Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Marketing = () => {
  const { CAMPAIGNS } = window.VINDATA;
  const [statusF, setStatusF] = React.useState("any");
  const [chF, setChF] = React.useState("any");
  let rows = CAMPAIGNS;
  if (statusF !== "any") rows = rows.filter(c => c.status.toLowerCase() === statusF);
  if (chF !== "any") rows = rows.filter(c => c.channel.toLowerCase() === chF);
  return (
    <div className="page">
      <SectionHeader
        title="Mass Marketing"
        subtitle={`${CAMPAIGNS.length} campaigns · ${CAMPAIGNS.reduce((s,c)=>s+c.sent,0).toLocaleString()} total sends · ${CAMPAIGNS.filter(c=>c.status==="Active").length} active`}
        actions={<Button variant="primary" icon="plus">New campaign</Button>}
      />
      <div className="kpi-row">
        <KPI label="Active" value={CAMPAIGNS.filter(c=>c.status==="Active").length} dot="var(--success)"/>
        <KPI label="Sent (30d)" value="18,420"/>
        <KPI label="Open rate" value="37%" trend="+4%" trendDir="up"/>
        <KPI label="Click rate" value="5.8%" trend="+0.6%" trendDir="up"/>
        <KPI label="Opted out" value="25" dot="var(--hot)"/>
      </div>
      <div className="filters-row">
        <div className="filters-label"><Icon name="filter" size={14}/> Filters</div>
        <select className="input" style={{width:140}} value={statusF} onChange={e=>setStatusF(e.target.value)}>
          <option value="any">Any status</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="draft">Draft</option>
        </select>
        <select className="input" style={{width:140}} value={chF} onChange={e=>setChF(e.target.value)}>
          <option value="any">Any channel</option><option value="email">Email</option><option value="sms">SMS</option><option value="voicemail">Voicemail</option>
        </select>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Sent</th><th>Open</th><th>Click</th><th>Replies</th><th>Opt-out</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td className="cell-strong">{c.name}</td>
                <td><div className="row"><Icon name={c.channel === "Email" ? "mail" : c.channel === "SMS" ? "sms" : "phone"} size={14}/><span>{c.channel}</span></div></td>
                <td><StatusBadge status={c.status}/></td>
                <td>{c.sent.toLocaleString()}</td>
                <td>{c.opened ? `${Math.round(c.opened*100)}%` : "—"}</td>
                <td>{c.clicked ? `${(c.clicked*100).toFixed(1)}%` : "—"}</td>
                <td>{c.replies}</td>
                <td>{c.optOut}</td>
                <td className="cell-muted">{c.created}</td>
                <td><Button variant="ghost" size="sm" icon="moreV"/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Users = () => {
  const { USERS } = window.VINDATA;
  const roleColor = { admin: "sb-info", carfax: "sb-warn", tlo: "sb-success", agent: "sb-neutral" };
  return (
    <div className="page">
      <SectionHeader
        title="Users"
        subtitle="Team members and their roles · admins can manage everything · agents see only their leads"
        actions={<Button variant="primary" icon="plus">Add user</Button>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KPI label="Total" value={USERS.length}/>
        <KPI label="Admins" value={USERS.filter(u=>u.role==="admin").length}/>
        <KPI label="Carfax" value={USERS.filter(u=>u.role==="carfax").length}/>
        <KPI label="TLO" value={USERS.filter(u=>u.role==="tlo").length}/>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {USERS.map(u => (
              <tr key={u.id}>
                <td><div className="row"><Avatar name={u.name} size={26}/><span className="cell-strong">{u.name}</span></div></td>
                <td className="cell-muted">{u.email}</td>
                <td className="cell-mono">{u.phone}</td>
                <td><span className={`status-badge ${roleColor[u.role] || "sb-neutral"}`}>{u.role}</span></td>
                <td className="cell-muted">{u.created}</td>
                <td><Button variant="ghost" size="sm" icon="edit">Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

Object.assign(window, { DuplicateReview, MergePrep, FilterReview, FilterRules, SLA, Marketing, Users });
