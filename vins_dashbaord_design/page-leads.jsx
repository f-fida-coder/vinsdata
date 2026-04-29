// Page: Leads (table) + Lead drawer

const SAVED_VIEWS = [
  { id: "all", label: "All leads", count: 84 },
  { id: "hot", label: "Hot · unassigned", count: 12 },
  { id: "mine", label: "My follow-ups", count: 7 },
  { id: "callbacks", label: "Callbacks today", count: 4 },
];

const Leads = ({ openLead }) => {
  const [view, setView] = React.useState("all");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [colsOpen, setColsOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(new Set());
  const [tier, setTier] = React.useState("all");
  const [temp, setTemp] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [q, setQ] = React.useState("");
  const { LEADS } = window.VINDATA;

  let rows = LEADS;
  if (tier !== "all") rows = rows.filter(l => l.tier === tier);
  if (temp !== "all") rows = rows.filter(l => l.temp === temp);
  if (status !== "all") rows = rows.filter(l => l.status === status);
  if (q) rows = rows.filter(l => [l.name,l.email,l.phone,l.vin,l.vehicle].some(v => (v||"").toLowerCase().includes(q.toLowerCase())));
  rows = rows.slice(0, 50);

  const toggleSel = id => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => { selected.size ? setSelected(new Set()) : setSelected(new Set(rows.map(r => r.id))); };

  const tempColors = { "Hot": "var(--hot)", "Warm": "var(--warm)", "Cold": "var(--cold)", "No answer": "var(--text-3)", "Closed": "var(--text-2)" };
  const statusColors = { "New": "var(--info)", "Callback": "var(--warm)", "Interested": "var(--success)", "Marketing": "var(--info)" };

  return (
    <div className="page">
      <SectionHeader
        title="CRM Leads"
        subtitle={
          <span><strong style={{ color: "var(--text-0)" }}>{LEADS.length}</strong> leads · <span style={{ color: "var(--warm)" }}>● 33 unassigned</span> · <span style={{ color: "var(--hot)" }}>● 14 hot</span></span>
        }
        actions={
          <>
            <Button variant="ghost" icon="upload" size="md">Import</Button>
            <Button variant="secondary" icon="download" size="md">Export</Button>
            <Button variant="primary" icon="plus" size="md">New lead</Button>
          </>
        }
      />

      {/* Saved views */}
      <div className="row" style={{ marginBottom: 12, gap: 6, flexWrap: "wrap" }}>
        {SAVED_VIEWS.map(v => (
          <span key={v.id} className={`saved-view ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
            <Icon name={view === v.id ? "starFill" : "star"} size={12}/>
            {v.label}
            <span style={{ opacity: 0.6, marginLeft: 4 }}>{v.count}</span>
          </span>
        ))}
        <span className="saved-view" style={{ color: "var(--text-2)" }}>
          <Icon name="plus" size={12}/> New view
        </span>
      </div>

      {/* Filter chip row */}
      <div className="chip-row">
        <span className="chip-group-label">Tier</span>
        <span className={`chip ${tier === "T1" ? "active" : ""}`} onClick={() => setTier(tier === "T1" ? "all" : "T1")}><span className="chip-dot" style={{ background: "var(--tier1)" }}/>Tier 1</span>
        <span className={`chip ${tier === "T2" ? "active" : ""}`} onClick={() => setTier(tier === "T2" ? "all" : "T2")}><span className="chip-dot" style={{ background: "var(--tier2)" }}/>Tier 2</span>
        <span className={`chip ${tier === "T3" ? "active" : ""}`} onClick={() => setTier(tier === "T3" ? "all" : "T3")}><span className="chip-dot" style={{ background: "var(--tier3)" }}/>Tier 3</span>
        <span style={{ color: "var(--border-1)" }}>·</span>
        <span className="chip-group-label">Temp</span>
        {["No answer","Cold","Warm","Hot"].map(t => (
          <span key={t} className={`chip ${temp === t ? "active" : ""}`} onClick={() => setTemp(temp === t ? "all" : t)}>
            <span className="chip-dot" style={{ background: tempColors[t] }}/>{t}
          </span>
        ))}
        <span style={{ color: "var(--border-1)" }}>·</span>
        <span className="chip-group-label">Status</span>
        {["New","Callback","Interested","Marketing"].map(s => (
          <span key={s} className={`chip ${status === s ? "active" : ""}`} onClick={() => setStatus(status === s ? "all" : s)}>
            <span className="chip-dot" style={{ background: statusColors[s] }}/>{s}
          </span>
        ))}
      </div>

      <div className="tbl-wrap">
        <div className="tbl-toolbar">
          <div className="tbl-search">
            <Input icon="search" placeholder="Search VIN, name, phone, email, city…   ( / )" value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          <Button variant="secondary" icon="filter" size="md" onClick={() => setFiltersOpen(o => !o)}>Filters {filtersOpen && <span style={{ marginLeft: 4, background: "var(--text-0)", color: "var(--bg-1)", borderRadius: 999, padding: "0 6px", fontSize: 11 }}>3</span>}</Button>
          <Button variant="ghost" size="md" icon="bookmark"/>
          <Button variant="ghost" size="md" icon="columns" onClick={() => setColsOpen(o => !o)}/>
          <Button variant="ghost" size="md" icon="download"/>
        </div>

        {filtersOpen && (
          <div style={{ padding: 16, borderBottom: "1px solid var(--border-0)", background: "var(--bg-2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
              <div>
                <label className="field-label">Vehicle · Make</label>
                <select className="input"><option>Any make</option>{window.VINDATA.MAKES.map(m => <option key={m}>{m}</option>)}</select>
              </div>
              <div><label className="field-label">Year</label><select className="input"><option>Any year</option>{Array.from({length:25}).map((_,i) => <option key={i}>{2026-i}</option>)}</select></div>
              <div><label className="field-label">State</label><select className="input"><option>Any state</option><option>TX</option><option>CA</option><option>FL</option><option>CO</option></select></div>
              <div><label className="field-label">Owners</label><div className="row"><Input placeholder="Min" style={{width:80}}/><span>—</span><Input placeholder="Max" style={{width:80}}/></div></div>
              <div><label className="field-label">Priority</label><select className="input"><option>Any priority</option><option>High</option><option>Medium</option><option>Low</option></select></div>
              <div><label className="field-label">Agent</label><select className="input"><option>Any assignee</option>{window.VINDATA.AGENTS.map(a => <option key={a}>{a}</option>)}</select></div>
              <div><label className="field-label">Label</label><select className="input"><option>Any label</option><option>Hot</option><option>Owner-financed</option></select></div>
              <div><label className="field-label">Open tasks</label><select className="input"><option>Any</option><option>0</option><option>1+</option></select></div>
              <div><label className="field-label">Source stage</label><select className="input"><option>Any stage</option><option>Generated</option><option>Carfax</option><option>Filter</option><option>TLO</option></select></div>
              <div><label className="field-label">Imported from</label><Input type="date"/></div>
              <div><label className="field-label">Imported to</label><Input type="date"/></div>
              <div><label className="field-label">Batch</label><select className="input"><option>Any batch</option><option>LandCruiser_2006_1</option></select></div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
              <Button variant="ghost" size="sm" onClick={() => { setTier("all"); setTemp("all"); setStatus("all"); }}>Reset</Button>
              <Button variant="primary" size="sm">Apply filters</Button>
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <div style={{ padding: "10px 14px", background: "var(--bg-2)", borderBottom: "1px solid var(--border-0)", display: "flex", alignItems: "center", gap: 10 }}>
            <strong>{selected.size} selected</strong>
            <span className="spacer"/>
            <Button variant="ghost" size="sm" icon="user">Assign</Button>
            <Button variant="ghost" size="sm" icon="tag">Add label</Button>
            <Button variant="ghost" size="sm" icon="mail">Email</Button>
            <Button variant="ghost" size="sm" icon="sms">SMS</Button>
            <Button variant="ghost" size="sm" icon="merge">Merge</Button>
            <Button variant="danger" size="sm" icon="trash">Delete</Button>
            <Button variant="ghost" size="sm" icon="x" onClick={() => setSelected(new Set())}/>
          </div>
        )}

        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="tbl-checkbox"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll}/></th>
                <th>Lead</th><th>Tier</th><th>Status</th><th>Priority</th><th>Temp</th><th>Agent</th><th>Labels</th><th>Wanted</th><th>Offered</th><th>Email</th><th>Location</th><th>Source file</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id} className={selected.has(l.id) ? "selected" : ""} onClick={() => openLead(l)}>
                  <td className="tbl-checkbox" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSel(l.id)}/>
                  </td>
                  <td>
                    <div className="lead-cell">
                      <div className="lead-name">{l.name}</div>
                      <div className="lead-vehicle">{l.vehicle}</div>
                      <div className="lead-phone">{l.phone}</div>
                      <div className="lead-vin">{l.vin}</div>
                    </div>
                  </td>
                  <td><TierDot tier={l.tier}/></td>
                  <td><StatusBadge status={l.status}/></td>
                  <td><PriorityChip priority={l.priority}/></td>
                  <td><TempPill temp={l.temp}/></td>
                  <td>
                    {l.agent === "Unassigned"
                      ? <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Unassigned</span>
                      : <div className="row"><Avatar name={l.agent} size={20}/><span style={{ fontSize: 12 }}>{l.agent}</span></div>}
                  </td>
                  <td>{l.labels.length ? l.labels.map(lab => <span key={lab} className="status-badge sb-neutral" style={{ marginRight: 4 }}>{lab}</span>) : <span className="cell-muted">—</span>}</td>
                  <td>{l.wanted ? <span className="cell-strong">${l.wanted.toLocaleString()}</span> : <span className="cell-muted">—</span>}</td>
                  <td>{l.offered ? <span className="cell-strong">${l.offered.toLocaleString()}</span> : <span className="cell-muted">—</span>}</td>
                  <td><span className="cell-muted">{l.email.length > 26 ? l.email.slice(0,24) + "…" : l.email}</span></td>
                  <td className="cell-muted">{l.location || "—"}</td>
                  <td className="cell-muted" style={{ fontSize: 11 }}>{l.sourceFile.length > 28 ? l.sourceFile.slice(0,26) + "…" : l.sourceFile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="tbl-pagination">
          <span>Showing {rows.length} of {LEADS.length} leads</span>
          <div className="tbl-pag-controls">
            <Button variant="ghost" size="sm" icon="chevronLeft">Prev</Button>
            <span>Page 1 / 2</span>
            <Button variant="ghost" size="sm" iconAfter="chevronRight">Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const LeadDrawer = ({ lead, onClose }) => {
  const [tab, setTab] = React.useState("activity");
  if (!lead) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <Avatar name={lead.name} size={32}/>
              <div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, letterSpacing: "-0.02em" }}>{lead.name}</h3>
                <div className="muted-text tiny">{lead.vehicle} · {lead.location || "—"}</div>
              </div>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <TierDot tier={lead.tier}/>
              <StatusBadge status={lead.status}/>
              <TempPill temp={lead.temp}/>
              <PriorityChip priority={lead.priority}/>
            </div>
          </div>
          <Button variant="ghost" icon="x" size="sm" onClick={onClose}/>
        </div>

        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-0)", display: "flex", gap: 6 }}>
          <Button variant="primary" icon="phone" size="sm">Call</Button>
          <Button variant="secondary" icon="mail" size="sm">Email</Button>
          <Button variant="secondary" icon="sms" size="sm">SMS</Button>
          <Button variant="ghost" icon="check" size="sm">Task</Button>
          <span className="spacer"/>
          <Button variant="ghost" icon="moreV" size="sm"/>
        </div>

        <div style={{ padding: "0 20px", borderBottom: "1px solid var(--border-0)" }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {["activity","details","tasks","files","notes"].map(t => (
              <span key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </span>
            ))}
          </div>
        </div>

        <div className="drawer-body">
          {tab === "activity" && (
            <>
              <div className="drawer-section">
                <div className="drawer-section-label">Quick info</div>
                <div className="kv-grid">
                  <div><div className="kv-key">Phone</div><div className="kv-val">{lead.phone}</div></div>
                  <div><div className="kv-key">Email</div><div className="kv-val" style={{ wordBreak: "break-all" }}>{lead.email}</div></div>
                  <div><div className="kv-key">VIN</div><div className="kv-val cell-mono">{lead.vin}</div></div>
                  <div><div className="kv-key">Agent</div><div className="kv-val">{lead.agent}</div></div>
                  <div><div className="kv-key">Wanted</div><div className="kv-val">{lead.wanted ? `$${lead.wanted.toLocaleString()}` : "—"}</div></div>
                  <div><div className="kv-key">Offered</div><div className="kv-val">{lead.offered ? `$${lead.offered.toLocaleString()}` : "—"}</div></div>
                  <div><div className="kv-key">Imported</div><div className="kv-val">{lead.imported}</div></div>
                  <div><div className="kv-key">Last touch</div><div className="kv-val">{lead.lastTouch}</div></div>
                </div>
              </div>
              <div className="drawer-section">
                <div className="drawer-section-label">Activity</div>
                <div className="timeline">
                  <div className="timeline-item">
                    <span className="timeline-dot current"/>
                    <div>
                      <div className="timeline-title">Lead imported</div>
                      <div className="timeline-meta">{lead.imported} · from {lead.sourceFile}</div>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <span className="timeline-dot done"/>
                    <div>
                      <div className="timeline-title">Outbound call · {lead.lastTouch}</div>
                      <div className="timeline-meta">Carfax1 · 2m 34s · Voicemail left</div>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <span className="timeline-dot done"/>
                    <div>
                      <div className="timeline-title">Email sent</div>
                      <div className="timeline-meta">"Land Cruiser owners — April outreach" · opened 2x</div>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <span className="timeline-dot done"/>
                    <div>
                      <div className="timeline-title">Status set to {lead.status}</div>
                      <div className="timeline-meta">Auto-rule · 4d ago</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === "details" && (
            <div className="drawer-section">
              <div className="drawer-section-label">Imported columns</div>
              <div className="kv-grid">
                {[
                  ["NumberOfOwners", "2"],["LastReportedState","TX"],["LastReportedMiles","148,200"],
                  ["AccidentHistory","None"],["TitleStatus","Clean"],["ServiceRecordCount","17"],
                  ["LastServiceDate","2025-11-04"],["LastServiceCity","Austin, TX"],["Age","42"],
                ].map(([k,v]) => <div key={k}><div className="kv-key">{k}</div><div className="kv-val">{v}</div></div>)}
              </div>
            </div>
          )}
          {tab === "tasks" && (
            <EmptyState icon="check" title="No open tasks" body="Create a task to follow up with this lead."/>
          )}
          {tab === "files" && (
            <EmptyState icon="folder" title="No files attached" body="Attach a Carfax or photos to keep them with this lead."/>
          )}
          {tab === "notes" && (
            <div>
              <textarea className="input" rows={5} placeholder="Add a note…" style={{ resize: "vertical" }}/>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}><Button variant="primary" size="sm">Save note</Button></div>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <Button variant="ghost" icon="merge">Merge</Button>
          <Button variant="ghost" icon="trash">Archive</Button>
          <span className="spacer"/>
          <Button variant="primary" iconAfter="arrowRight">Open full record</Button>
        </div>
      </div>
    </>
  );
};

window.Leads = Leads;
window.LeadDrawer = LeadDrawer;
