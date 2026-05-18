// Page: Dashboard

const Dashboard = ({ openLead, openFile }) => {
  const { FILES } = window.VINDATA;
  const [filter, setFilter] = React.useState({ vehicle: "all", stage: "all", year: "" });

  return (
    <div className="page">
      <SectionHeader
        title="Dashboard"
        subtitle={`${FILES.length} total files across all stages · last refreshed just now`}
        actions={
          <>
            <Button variant="ghost" icon="refresh" size="md">Refresh</Button>
            <Button variant="secondary" icon="download" size="md">Export</Button>
            <Button variant="primary" icon="plus" size="md">Add File</Button>
          </>
        }
      />

      <div className="kpi-row">
        <KPI label="Generated" value="14" hint="+3 this week" dot="var(--text-2)" trend="+21%" trendDir="up"/>
        <KPI label="Carfax" value="11" hint="2 in queue" dot="var(--warm)" trend="+8%" trendDir="up"/>
        <KPI label="Filter" value="9" hint="3 awaiting review" dot="var(--cold)" trend="−2%" trendDir="down"/>
        <KPI label="TLO" value="6" hint="enriched" dot="var(--success)" trend="+12%" trendDir="up"/>
        <KPI label="Flagged" value="2" hint="needs attention" dot="var(--hot)" trend="0" trendDir=""/>
      </div>

      <div className="mkt-strip" style={{ background: "linear-gradient(135deg, var(--bg-1) 0%, var(--bg-2) 100%)" }}>
        <div className="mkt-strip-head">
          <span className="mkt-strip-icon"><Icon name="sparkles" size={16}/></span>
          <div>
            <div className="mkt-strip-title">Marketing</div>
            <div className="mkt-strip-sub">last 30 days</div>
          </div>
        </div>
        <div className="mkt-stat"><div className="mkt-stat-v">3</div><div className="mkt-stat-l">Active</div></div>
        <div className="mkt-stat"><div className="mkt-stat-v">6,364</div><div className="mkt-stat-l">Sent 7d</div></div>
        <div className="mkt-stat"><div className="mkt-stat-v">18,420</div><div className="mkt-stat-l">Sent 30d</div></div>
        <div className="mkt-stat"><div className="mkt-stat-v">37%</div><div className="mkt-stat-l">Open rate</div></div>
        <div className="mkt-stat"><div className="mkt-stat-v">5.8%</div><div className="mkt-stat-l">Click rate</div></div>
        <div className="mkt-stat"><div className="mkt-stat-v">25</div><div className="mkt-stat-l">Opted out</div></div>
        <Button variant="ghost" size="sm" iconAfter="arrowRight">All campaigns</Button>
      </div>

      <div className="filters-row">
        <div className="filters-label"><Icon name="filter" size={14}/> Filters</div>
        <select className="input" style={{ width: 160 }} value={filter.vehicle} onChange={e => setFilter(f => ({...f, vehicle: e.target.value}))}>
          <option value="all">All Vehicles</option>
          {window.VINDATA.VEHICLES.map(v => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={filter.stage} onChange={e => setFilter(f => ({...f, stage: e.target.value}))}>
          <option value="all">All Stages</option>
          <option>Generated</option><option>Carfax</option><option>Filter</option><option>TLO</option><option>Complete</option>
        </select>
        <Input placeholder="Year" style={{ width: 100 }} value={filter.year} onChange={e => setFilter(f => ({...f, year: e.target.value}))}/>
        <span className="spacer"/>
        <Button variant="ghost" size="sm" icon="bookmark">Save view</Button>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="tbl-checkbox"><input type="checkbox"/></th>
              <th>File</th><th>Vehicle</th><th>Year</th><th>Status</th><th>Pipeline</th><th>Downloads</th><th>Owner</th><th>Updated</th><th></th>
            </tr>
          </thead>
          <tbody>
            {FILES.map(f => (
              <tr key={f.id} onClick={() => openFile(f)}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox"/></td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name="file" size={14} style={{ color: "var(--text-2)" }}/>
                    <span className="cell-strong">{f.name}</span>
                    {f.flagged && <span className="status-badge sb-warn">flagged</span>}
                  </div>
                </td>
                <td className="cell-muted">{f.vehicle}</td>
                <td className="cell-muted">{f.year}</td>
                <td><StatusBadge status={f.status}/></td>
                <td><StageDots stages={f.pipeline}/></td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {["gen","car","fil","tlo"].map((l, i) => f.pipeline[i] ? <span key={l} className="dl-chip"><Icon name="download" size={11}/>{l}</span> : null)}
                  </div>
                </td>
                <td className="cell-muted">{f.owner}</td>
                <td className="cell-muted">{f.updated}</td>
                <td onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" icon="moreV"/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-pagination">
          <span>Rows per page: 50 · {FILES.length} of {FILES.length}</span>
          <div className="tbl-pag-controls">
            <Button variant="ghost" size="sm" icon="chevronLeft">Prev</Button>
            <span>Page 1 / 1</span>
            <Button variant="ghost" size="sm" iconAfter="chevronRight">Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FileDrawer = ({ file, onClose }) => {
  if (!file) return null;
  const stageLabels = ["Generated","Carfax","Filter","TLO"];
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, letterSpacing: "-0.02em" }}>{file.name}</h3>
            <div className="muted-text tiny" style={{ marginTop: 4 }}>{file.vehicle}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <StatusBadge status={file.status}/>
              <span className="cell-muted">Stage: TLO</span>
            </div>
          </div>
          <Button variant="ghost" icon="x" size="sm" onClick={onClose}/>
        </div>
        <div className="drawer-body">
          <Button variant="primary" icon="upload" style={{ marginBottom: 16 }}>Import final file</Button>
          <div className="drawer-section">
            <div className="kv-grid">
              <div><div className="kv-key">Created by</div><div className="kv-val">{file.owner}</div></div>
              <div><div className="kv-key">Assigned to</div><div className="kv-val">—</div></div>
              <div><div className="kv-key">Created at</div><div className="kv-val">4/18/2026, 3:17 PM</div></div>
              <div><div className="kv-key">Updated at</div><div className="kv-val">{file.updated}</div></div>
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-label">Stages</div>
            {stageLabels.map((s, i) => (
              <div key={s} className="card" style={{ marginBottom: 8, padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row">
                    <span className="stage-dot done" style={{ background: file.pipeline[i] ? "var(--success)" : "var(--bg-3)" }}/>
                    <strong>{s}</strong>
                    {file.pipeline[i] ? <span className="status-badge sb-success">DONE</span> : <span className="status-badge sb-muted">pending</span>}
                  </div>
                  <span className="cell-muted tiny">v3</span>
                </div>
                {file.pipeline[i] && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-2)", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span className="status-badge sb-neutral" style={{ marginRight: 6 }}>LATEST</span>
                      <span className="cell-mono">{file.name.replace("VIN_v3", `VIN_${s.slice(0,3).toUpperCase()}`)}.csv</span>
                    </div>
                    <Button variant="ghost" size="sm" icon="download">Download</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="drawer-section">
            <div className="drawer-section-label">Timeline</div>
            <div className="timeline">
              {[
                { title: "Completed · TLO", time: "4/18/2026, 3:18 PM · Admin", note: "Auto-complete on TLO", done: true, current: false },
                { title: "Advanced · Filter → TLO", time: "4/18/2026, 3:14 PM · Admin", done: true },
                { title: "Filter pass complete", time: "4/18/2026, 3:11 PM · Carfax1", done: true },
                { title: "Carfax pull", time: "4/18/2026, 3:01 PM · Carfax1", done: true },
                { title: "Generated", time: "4/18/2026, 2:45 PM · Admin", done: true },
              ].map((t,i) => (
                <div key={i} className="timeline-item">
                  <span className={`timeline-dot ${t.done ? "done" : ""}`}/>
                  <div>
                    <div className="timeline-title">{t.title}</div>
                    <div className="timeline-meta">{t.time}</div>
                    {t.note && <div className="timeline-meta">{t.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <Button variant="ghost" icon="copy">Duplicate</Button>
          <Button variant="ghost" icon="trash">Archive</Button>
          <span className="spacer"/>
          <Button variant="primary" icon="play">Advance stage</Button>
        </div>
      </div>
    </>
  );
};

window.Dashboard = Dashboard;
window.FileDrawer = FileDrawer;
