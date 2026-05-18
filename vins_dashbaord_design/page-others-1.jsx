// Page: Pipeline kanban + Vehicles + Tasks + Deals + Reports

const Pipeline = ({ openLead }) => {
  const cols = [
    { key: "No answer", label: "No Answer", color: "var(--text-3)" },
    { key: "Cold", label: "Cold", color: "var(--cold)" },
    { key: "Warm", label: "Warm", color: "var(--warm)" },
    { key: "Hot", label: "Hot", color: "var(--hot)" },
    { key: "Closed", label: "Closed", color: "var(--success)" },
  ];
  const { LEADS } = window.VINDATA;
  const grouped = Object.fromEntries(cols.map(c => [c.key, LEADS.filter(l => l.temp === c.key).slice(0, 7)]));

  const [scope, setScope] = React.useState("all");

  return (
    <div className="page">
      <SectionHeader
        title="Lead Pipeline"
        subtitle={`Every lead grouped by temperature · ${LEADS.length} total in view · drag to reorder`}
        actions={
          <>
            <div className="seg">
              <button className={`seg-btn ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>All leads</button>
              <button className={`seg-btn ${scope === "mine" ? "active" : ""}`} onClick={() => setScope("mine")}>My leads</button>
            </div>
            <Button variant="ghost" icon="filter" size="md">Filter</Button>
            <Button variant="primary" icon="plus" size="md">New lead</Button>
          </>
        }
      />
      <div className="kanban">
        {cols.map(c => (
          <div key={c.key} className="kanban-col">
            <div className="kanban-col-head">
              <span className="row"><span className="kanban-col-dot" style={{ background: c.color }}/>{c.label}</span>
              <span className="count">{grouped[c.key].length}</span>
            </div>
            {grouped[c.key].map(l => (
              <div key={l.id} className="kanban-card" onClick={() => openLead(l)}>
                <div className="kanban-card-head">
                  <span className="kanban-card-name">{l.name}</span>
                  <Icon name="moreV" size={14} style={{ color: "var(--text-3)" }}/>
                </div>
                <div className="kanban-card-vehicle">{l.vehicle}</div>
                <div className="kanban-card-vehicle">{l.phone}</div>
                <div className="kanban-card-meta">
                  <StatusBadge status={l.status}/>
                  {l.offered && <span className="cell-mono" style={{ color: "var(--text-1)" }}>${l.offered.toLocaleString()}</span>}
                </div>
                <div className="kanban-card-foot">
                  <span>{l.agent === "Unassigned" ? <em style={{ color: "var(--text-3)" }}>Unassigned</em> : <><Avatar name={l.agent} size={16}/> {l.agent}</>}</span>
                  <span>{l.lastTouch}</span>
                </div>
              </div>
            ))}
            {grouped[c.key].length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No leads</div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center", marginTop: 4, color: "var(--text-2)" }}>
              <Icon name="plus" size={12}/> Add lead
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const Vehicles = () => {
  const { VEHICLES } = window.VINDATA;
  return (
    <div className="page">
      <SectionHeader
        title="Vehicles"
        subtitle="One row per vehicle the team is hunting · files are assigned to vehicles · leads carry year, make, model"
        actions={<><Button variant="secondary" icon="search">Search</Button><Button variant="primary" icon="plus">New vehicle</Button></>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KPI label="Vehicles" value={VEHICLES.length}/>
        <KPI label="Total leads" value={VEHICLES.reduce((s,v) => s+v.leads, 0)}/>
        <KPI label="Total files" value={VEHICLES.reduce((s,v) => s+v.files, 0)}/>
        <KPI label="Top performer" value="Land Cruiser" hint="36 active leads"/>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Make</th><th>Model</th><th>Year</th><th>Leads</th><th>Files</th><th>Name</th><th></th></tr></thead>
          <tbody>
            {VEHICLES.map(v => (
              <tr key={v.id}>
                <td className="cell-strong">{v.make}</td>
                <td>{v.model}</td>
                <td className="cell-muted">{v.year || "—"}</td>
                <td><span className={v.leads > 0 ? "cell-strong" : "cell-muted"}>{v.leads}</span></td>
                <td><span className={v.files > 0 ? "cell-strong" : "cell-muted"}>{v.files}</span></td>
                <td className="cell-muted">{v.name}</td>
                <td><Button variant="ghost" size="sm" icon="edit">Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Tasks = () => {
  const [tab, setTab] = React.useState("My open tasks");
  const { TASKS } = window.VINDATA;
  let rows = TASKS;
  if (tab === "Due today") rows = rows.filter(t => t.due === "2026-04-28");
  if (tab === "Overdue") rows = rows.filter(t => t.status === "overdue");
  return (
    <div className="page">
      <SectionHeader
        title="Tasks"
        subtitle="Tasks assigned to you that are still open"
        actions={<Button variant="primary" icon="plus">New task</Button>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <KPI label="Open Tasks" value={TASKS.filter(t => t.status === "open").length} dot="var(--text-2)"/>
        <KPI label="Due Today" value={TASKS.filter(t => t.due === "2026-04-28").length} dot="var(--warm)"/>
        <KPI label="Overdue" value={TASKS.filter(t => t.status === "overdue").length} dot="var(--hot)"/>
        <KPI label="Unassigned leads" value="33" dot="var(--cold)"/>
      </div>
      <div className="tabs">
        {["My open tasks","Due today","Overdue","All open"].map(t => (
          <span key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</span>
        ))}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th className="tbl-checkbox"><input type="checkbox"/></th><th>Task</th><th>Lead</th><th>Priority</th><th>Due</th><th>Assignee</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id}>
                <td className="tbl-checkbox" onClick={e => e.stopPropagation()}><input type="checkbox"/></td>
                <td className="cell-strong">{t.title}</td>
                <td className="cell-muted">{t.lead}</td>
                <td><PriorityChip priority={t.priority}/></td>
                <td><span className={t.status === "overdue" ? "" : "cell-muted"} style={t.status === "overdue" ? { color: "var(--danger)" } : {}}>{t.due}{t.status === "overdue" && " · overdue"}</span></td>
                <td><div className="row"><Avatar name={t.assignee} size={20}/><span style={{fontSize:12}}>{t.assignee}</span></div></td>
                <td><StatusBadge status={t.status === "overdue" ? "Disqualified" : "New"}/></td>
                <td><Button variant="ghost" size="sm" icon="moreV"/></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState icon="check" title="You have no tasks here" body="Great work — go close some leads."/>}
      </div>
    </div>
  );
};

const Deals = () => {
  const [tab, setTab] = React.useState("All");
  const { DEALS } = window.VINDATA;
  let rows = DEALS;
  if (tab !== "All") rows = rows.filter(d => d.stage === tab);
  const totalCost = rows.reduce((s,d) => s+d.cost, 0);
  const totalSale = rows.reduce((s,d) => s+d.sale, 0);
  const totalProfit = rows.reduce((s,d) => s+d.profit, 0);
  const avgDays = rows.length ? Math.round(rows.reduce((s,d) => s+d.days,0)/rows.length) : 0;
  return (
    <div className="page">
      <SectionHeader
        title="Deals"
        subtitle="Acquisitions and resales · a deal exists for any lead with purchase data captured"
        actions={<Button variant="primary" icon="plus">New deal</Button>}
      />
      <div className="seg" style={{ marginBottom: 16 }}>
        {["All","Open","Acquired","Sold"].map(t => (
          <button key={t} className={`seg-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="kpi-row">
        <KPI label="Deals in view" value={rows.length}/>
        <KPI label="Total cost" value={`$${totalCost.toLocaleString()}`}/>
        <KPI label="Total sale" value={`$${totalSale.toLocaleString()}`}/>
        <KPI label="Net profit" value={`$${totalProfit.toLocaleString()}`} dot="var(--success)" trend="+18%" trendDir="up"/>
        <KPI label="Avg days on market" value={avgDays || "—"}/>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Lead</th><th>Vehicle</th><th>Stage</th><th>Cost</th><th>Sale</th><th>Profit</th><th>Days</th><th>Agent</th><th>Closed</th></tr></thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id}>
                <td className="cell-strong">{d.lead}</td>
                <td className="cell-muted">{d.vehicle}</td>
                <td><StatusBadge status={d.stage}/></td>
                <td>{d.cost ? `$${d.cost.toLocaleString()}` : "—"}</td>
                <td>{d.sale ? `$${d.sale.toLocaleString()}` : "—"}</td>
                <td><strong style={{ color: d.profit > 0 ? "var(--success)" : "var(--text-1)" }}>{d.profit ? `$${d.profit.toLocaleString()}` : "—"}</strong></td>
                <td>{d.days}</td>
                <td><div className="row"><Avatar name={d.agent} size={20}/><span style={{fontSize:12}}>{d.agent}</span></div></td>
                <td className="cell-muted">{d.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Bar = ({ label, count, max, color = "var(--text-0)" }) => (
  <div className="bar-row">
    <span className="bar-label"><span className="chip-dot" style={{ background: color }}/>{label}</span>
    <span className="bar-track"><span className="bar-fill" style={{ width: `${max ? (count/max)*100 : 0}%`, background: color }}/></span>
    <span className="bar-count">{count}</span>
  </div>
);

const Reports = () => {
  const status = [["New",36],["Contacted",18],["Callback",12],["Interested",9],["Not interested",4],["Wrong number",6],["No answer",14],["Voicemail left",8],["Deal closed",2],["Nurture",5],["Disqualified",3],["Do not call",1],["Marketing",22]];
  const temp = [["No answer",18,"var(--text-3)"],["Cold",24,"var(--cold)"],["Warm",16,"var(--warm)"],["Hot",14,"var(--hot)"],["Closed",2,"var(--success)"]];
  const priority = [["Low",12,"var(--cold)"],["Medium",58,"var(--text-1)"],["High",14,"var(--danger)"]];
  const stage = [["Generated",4,"var(--text-3)"],["Carfax",11,"var(--warm)"],["Filter",9,"var(--cold)"],["TLO",6,"var(--success)"]];
  const matchTypes = [["vin",4],["phone",2],["email",3],["address+last",1],["name+phone",1]];

  return (
    <div className="page">
      <SectionHeader
        title="Reports"
        subtitle="Snapshot of the CRM's current state · updates each time you reload the page"
        actions={<Button variant="secondary" icon="refresh">Refresh</Button>}
      />
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
        <KPI label="Total Leads" value="84"/>
        <KPI label="Unassigned" value="33" dot="var(--warm)"/>
        <KPI label="Imported today" value="12"/>
        <KPI label="Imported (7d)" value="58"/>
        <KPI label="Open tasks" value="7"/>
        <KPI label="Tasks overdue" value="2" dot="var(--hot)"/>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-head"><div><div className="card-title">By status</div><div className="card-sub">Lead lifecycle stage · click to filter</div></div></div>
          {status.map(([l,c]) => <Bar key={l} label={l} count={c} max={36}/>)}
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">By temperature</div><div className="card-sub">Outreach state · click to filter</div></div></div>
          {temp.map(([l,c,col]) => <Bar key={l} label={l} count={c} max={24} color={col}/>)}
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">By priority</div><div className="card-sub">Operator-set priority · click to filter</div></div></div>
          {priority.map(([l,c,col]) => <Bar key={l} label={l} count={c} max={58} color={col}/>)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-head"><div><div className="card-title">By data stage</div><div className="card-sub">Where each VIN is in the enrichment pipeline · click to drill in</div></div></div>
          {stage.map(([l,c,col]) => <Bar key={l} label={l} count={c} max={11} color={col}/>)}
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Tasks</div><div className="card-sub">Active task workload · click to drill in</div></div></div>
          <div className="grid-3" style={{ marginTop: 6 }}>
            <div><div className="kpi-label">Open</div><div className="kpi-value" style={{ fontSize: 28 }}>7</div></div>
            <div><div className="kpi-label">Due today</div><div className="kpi-value" style={{ fontSize: 28, color: "var(--warm)" }}>3</div></div>
            <div><div className="kpi-label">Overdue</div><div className="kpi-value" style={{ fontSize: 28, color: "var(--danger)" }}>2</div></div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Duplicate groups</div><div className="card-sub">5 total · 2 new this week</div></div></div>
          {[["Pending",2,"var(--warm)"],["Confirmed",2,"var(--success)"],["Not duplicate",0,"var(--text-3)"],["Ignored",1,"var(--text-3)"]].map(([l,c,col]) => <Bar key={l} label={l} count={c} max={2} color={col}/>)}
          <div className="grid-3" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-0)" }}>
            <div><div className="kpi-label">Confirmed</div><div className="kpi-value" style={{fontSize:24}}>2</div></div>
            <div><div className="kpi-label">Prep draft</div><div className="kpi-value" style={{fontSize:24}}>1</div></div>
            <div><div className="kpi-label">Prepared</div><div className="kpi-value" style={{fontSize:24}}>1</div></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Match types</div><div className="card-sub">What attribute paired the dup cases</div></div></div>
          {matchTypes.map(([l,c]) => <Bar key={l} label={l} count={c} max={4}/>)}
        </div>
      </div>
    </div>
  );
};

window.Pipeline = Pipeline;
window.Vehicles = Vehicles;
window.Tasks = Tasks;
window.Deals = Deals;
window.Reports = Reports;
