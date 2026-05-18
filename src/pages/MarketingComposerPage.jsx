import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { extractApiError } from '../api';
import {
  MARKETING_CHANNELS,
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES, LEAD_TIERS,
} from '../lib/crm';
import { Button, Icon, SectionHeader } from '../components/ui';

const STEPS = [
  { key: 'basics',     label: 'Basics' },
  { key: 'template',   label: 'Template' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'review',     label: 'Review' },
];

const SAMPLE_VARS = {
  first_name: 'Alex',
  last_name:  'Smith',
  full_name:  'Alex Smith',
  vehicle:    '2015 Toyota Camry',
  vin:        '1HGCM82633A004352',
  city:       'Austin',
  state:      'TX',
  unsubscribe_url: 'https://example.com/unsub/…',
};

function renderPreview(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
  });
}

export default function MarketingComposerPage() {
  const nav = useNavigate();
  const [step, setStep] = useState('basics');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName]           = useState('');
  const [channel, setChannel]     = useState('email');

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject]     = useState('');
  const [body, setBody]           = useState('');
  const [senderIdentity, setSenderIdentity] = useState('');

  const [segment, setSegment]     = useState({ status: 'new' });
  const [preview, setPreview]     = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [options, setOptions]     = useState({ batches: [], files: [], stages: [], states: [], makes: [], years: [], labels: [] });

  useEffect(() => {
    api.get('/lead_filter_options').then((r) => setOptions(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/marketing_templates', { params: { channel, active: 1 } })
      .then((r) => setTemplates(r.data || []))
      .catch(() => setTemplates([]));
  }, [channel]);

  const applyTemplate = (id) => {
    setTemplateId(id);
    if (!id) return;
    const tpl = templates.find((t) => String(t.id) === String(id));
    if (tpl) { setSubject(tpl.subject || ''); setBody(tpl.body || ''); }
  };

  const previewCounts = useCallback(async (currentSegment) => {
    setPreviewing(true);
    try {
      const params = { ...currentSegment, preview_count: 1 };
      Object.keys(params).forEach((k) => { if (params[k] === '' || params[k] == null) delete params[k]; });
      const res = await api.get('/leads', { params });
      setPreview(res.data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 'recipients') return;
    const t = setTimeout(() => previewCounts(segment), 350);
    return () => clearTimeout(t);
  }, [segment, step, previewCounts]);

  const reachable = useMemo(() => {
    if (!preview) return null;
    return channel === 'email' ? preview.reachable_by_email : preview.reachable_by_phone;
  }, [preview, channel]);

  const canNext = useMemo(() => {
    if (step === 'basics')     return name.trim().length > 0;
    if (step === 'template')   return body.trim().length > 0 && (channel !== 'email' || subject.trim().length > 0);
    if (step === 'recipients') return (reachable ?? 0) > 0;
    return true;
  }, [step, name, body, subject, channel, reachable]);

  const go = (delta) => {
    const idx = STEPS.findIndex((s) => s.key === step);
    const nextIdx = Math.max(0, Math.min(STEPS.length - 1, idx + delta));
    setStep(STEPS[nextIdx].key);
  };

  const submit = async (andSendNow) => {
    setSubmitting(true); setError('');
    try {
      const payload = {
        name: name.trim(),
        channel,
        segment,
        template_id: templateId ? Number(templateId) : null,
        subject: channel === 'email' ? subject : null,
        body,
        sender_identity: senderIdentity || null,
      };
      const res = await api.post('/marketing_campaigns', payload);
      const id = res.data?.id;
      if (id && andSendNow) {
        if (window.confirm(`Send this campaign to ${reachable ?? '?'} recipients now? This cannot be undone.`)) {
          await api.post('/marketing_send', { campaign_id: id });
        }
      }
      if (id) nav(`/marketing/${id}`);
    } catch (err) {
      setError(extractApiError(err, 'Failed to create campaign'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <SectionHeader
        title="New campaign"
        subtitle="Send a marketing message to a segment of leads."
        actions={
          <Button variant="ghost" icon="chevronLeft" onClick={() => nav('/marketing')}>
            Back
          </Button>
        }
      />

      {/* Stepper */}
      <div className="mc-stepper">
        {STEPS.map((s, i) => {
          const idx  = STEPS.findIndex((x) => x.key === step);
          const done = i < idx;
          const cur  = i === idx;
          return (
            <div key={s.key} className={`mc-step ${cur ? 'is-current' : ''} ${done ? 'is-done' : ''}`}>
              <button
                type="button"
                onClick={() => i <= idx && setStep(s.key)}
                disabled={i > idx}
                className="mc-step-btn"
              >
                <span className="mc-step-num">{done ? '✓' : i + 1}</span>
                <span className="mc-step-label">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span className={`mc-step-line ${done ? 'is-done' : ''}`}/>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          className="row"
          style={{
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 16,
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18 }}
          >&times;</button>
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        {step === 'basics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label className="field-label">Campaign name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q2 nurture — 2015–2018 Camrys"
                className="vv-input"
              />
            </div>
            <div>
              <label className="field-label">Channel</label>
              <div className="mc-channels" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {MARKETING_CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setChannel(c.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-lg)',
                      border: `1px solid ${channel === c.key ? 'var(--accent)' : 'var(--border-1)'}`,
                      background: channel === c.key ? 'var(--bg-2)' : 'var(--bg-1)',
                      color: channel === c.key ? 'var(--text-0)' : 'var(--text-2)',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
              {channel !== 'email' && (
                <p className="tiny" style={{ color: 'var(--warn)', marginTop: 8 }}>
                  SMS and WhatsApp are simulated in Phase 1 — sends are logged but not actually delivered until a provider is configured.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 'template' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label className="field-label">Start from a saved template (optional)</label>
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="vv-input"
              >
                <option value="">— Write from scratch —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {channel === 'email' && (
              <div>
                <label className="field-label">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick question about your {{vehicle}}"
                  className="vv-input"
                />
              </div>
            )}
            <div>
              <label className="field-label">Body</label>
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Hi {{first_name}},\n\nWe're buying cars like your {{vehicle}} right now…`}
                className="vv-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, resize: 'vertical' }}
              />
              <p className="tiny cell-muted" style={{ marginTop: 6 }}>
                Available variables: <code style={{ fontFamily: 'var(--font-mono)' }}>{'{{first_name}} {{last_name}} {{full_name}} {{vehicle}} {{vin}} {{city}} {{state}}'}</code>.
                An unsubscribe footer is added automatically.
              </p>
            </div>
            <div>
              <label className="field-label">Sender identity (optional)</label>
              <input
                type="text"
                value={senderIdentity}
                onChange={(e) => setSenderIdentity(e.target.value)}
                placeholder={channel === 'email' ? '"Your Name" <you@your-domain.com>' : 'Your SMS sender / WhatsApp number'}
                className="vv-input"
              />
            </div>
            <div className="card" style={{ background: 'var(--bg-2)' }}>
              <div className="drawer-section-label">Preview (sample data)</div>
              {channel === 'email' && (
                <div className="cell-strong" style={{ marginBottom: 8 }}>
                  {renderPreview(subject, SAMPLE_VARS) || <span className="cell-muted">(no subject)</span>}
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-1)' }}>
                {renderPreview(body, SAMPLE_VARS) || <span className="cell-muted">(no body)</span>}
              </div>
            </div>
          </div>
        )}

        {step === 'recipients' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card" style={{ background: 'var(--info-bg)', borderColor: 'transparent' }}>
              <div className="drawer-section-label" style={{ color: 'var(--info)' }}>Quick presets</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="chip" onClick={() => setSegment({ lead_temperature: 'cold' })}>
                  <span className="chip-dot" style={{ background: 'var(--cold)' }}/>
                  Cold leads pool
                </span>
                <span className="chip" onClick={() => setSegment({ status: 'marketing' })}>
                  <span className="chip-dot" style={{ background: 'var(--info)' }}/>
                  In "Marketing" status
                </span>
                <span className="chip" onClick={() => setSegment({ tier: 'tier_3', lead_temperature: 'cold' })}>
                  <span className="chip-dot" style={{ background: 'var(--text-3)' }}/>
                  Tier 3 + Cold
                </span>
                <span className="chip" onClick={() => setSegment({})}>
                  Reset filters
                </span>
              </div>
            </div>
            <p className="tiny cell-muted" style={{ marginBottom: -4 }}>Or narrow the segment with the filters below.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <SegSelect label="Status"       value={segment.status || ''} onChange={(v) => setSegment({ ...segment, status: v })}>
                <option value="">Any status</option>
                {LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </SegSelect>
              <SegSelect label="Priority"     value={segment.priority || ''} onChange={(v) => setSegment({ ...segment, priority: v })}>
                <option value="">Any priority</option>
                {LEAD_PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </SegSelect>
              <SegSelect label="Temperature"  value={segment.lead_temperature || ''} onChange={(v) => setSegment({ ...segment, lead_temperature: v })}>
                <option value="">Any temperature</option>
                {LEAD_TEMPERATURES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </SegSelect>
              <SegSelect label="Tier"         value={segment.tier || ''} onChange={(v) => setSegment({ ...segment, tier: v })}>
                <option value="">Any tier</option>
                {LEAD_TIERS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>)}
              </SegSelect>
              <SegSelect label="Source stage" value={segment.source_stage || ''} onChange={(v) => setSegment({ ...segment, source_stage: v })}>
                <option value="">Any stage</option>
                {options.stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </SegSelect>
              <SegSelect label="Batch"        value={segment.batch_id || ''} onChange={(v) => setSegment({ ...segment, batch_id: v })}>
                <option value="">Any batch</option>
                {options.batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
              </SegSelect>
              <SegSelect label="State"        value={segment.state || ''} onChange={(v) => setSegment({ ...segment, state: v })}>
                <option value="">Any state</option>
                {options.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </SegSelect>
              <SegSelect label="Make"         value={segment.make || ''} onChange={(v) => setSegment({ ...segment, make: v })}>
                <option value="">Any make</option>
                {options.makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </SegSelect>
              <SegSelect label="Year"         value={segment.year || ''} onChange={(v) => setSegment({ ...segment, year: v })}>
                <option value="">Any year</option>
                {options.years.map((y) => <option key={y} value={y}>{y}</option>)}
              </SegSelect>
              <SegSelect label="Label"        value={segment.label_id || ''} onChange={(v) => setSegment({ ...segment, label_id: v })}>
                <option value="">Any label</option>
                {options.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </SegSelect>
            </div>

            <div className="card" style={{ background: 'var(--bg-2)' }}>
              {previewing ? (
                <div className="cell-muted">Counting…</div>
              ) : preview ? (
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div className="kpi-value" style={{ fontSize: 32 }}>
                      {(reachable ?? 0).toLocaleString()}
                    </div>
                    <div className="cell-muted tiny">
                      of {preview.total.toLocaleString()} matching leads are reachable by <strong>{channel}</strong>
                    </div>
                  </div>
                  <div className="cell-muted tiny" style={{ textAlign: 'right' }}>
                    <div>Capped at 500 per campaign in Phase 1</div>
                    <div>Opted-out recipients will be skipped automatically</div>
                  </div>
                </div>
              ) : (
                <div className="cell-muted">Adjust filters to see a count.</div>
              )}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row label="Name">{name}</Row>
            <Row label="Channel">{MARKETING_CHANNELS.find((c) => c.key === channel)?.label}</Row>
            {channel === 'email' && <Row label="Subject">{renderPreview(subject, SAMPLE_VARS) || <span className="cell-muted">—</span>}</Row>}
            <Row label="Body">
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  margin: 0,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-0)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-1)',
                }}
              >
                {renderPreview(body, SAMPLE_VARS)}
              </pre>
            </Row>
            <Row label="Segment">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(segment).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                  <span key={k} className="status-badge sb-info">
                    {k}: <strong style={{ marginLeft: 2 }}>{String(v)}</strong>
                  </span>
                ))}
                {Object.values(segment).every((v) => v === '' || v == null) && <span className="cell-muted tiny">All leads</span>}
              </div>
            </Row>
            <Row label="Recipients">
              {preview ? (
                <span>{(reachable ?? 0).toLocaleString()} reachable / {preview.total.toLocaleString()} matching</span>
              ) : <span className="cell-muted">—</span>}
            </Row>
          </div>
        )}

        {/* Footer actions */}
        <div
          className="row"
          style={{
            justifyContent: 'space-between',
            marginTop: 28,
            paddingTop: 20,
            borderTop: '1px solid var(--border-0)',
          }}
        >
          <Button variant="ghost" onClick={() => go(-1)} disabled={step === STEPS[0].key || submitting} icon="chevronLeft">
            Back
          </Button>
          {step !== 'review' ? (
            <Button variant="primary" onClick={() => go(1)} disabled={!canNext} iconAfter="arrowRight">
              Next
            </Button>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <Button variant="secondary" onClick={() => submit(false)} disabled={submitting}>
                Save as draft
              </Button>
              <Button variant="primary" icon="play" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? 'Creating…' : `Send now${reachable ? ` (${reachable})` : ''}`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SegSelect({ label, value, onChange, children }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="vv-input">
        {children}
      </select>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="mc-row" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'start' }}>
      <div className="kv-key" style={{ paddingTop: 4 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
