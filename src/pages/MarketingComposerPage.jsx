import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { extractApiError } from '../api';
import {
  MARKETING_CHANNELS,
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES, LEAD_TIERS,
} from '../lib/crm';

// The 4 wizard steps, in order. Matches the plan from the architectural proposal.
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

  // Step 1: basics
  const [name, setName]           = useState('');
  const [channel, setChannel]     = useState('email');

  // Step 2: template
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject]     = useState('');
  const [body, setBody]           = useState('');
  const [senderIdentity, setSenderIdentity] = useState('');

  // Step 3: recipients
  const [segment, setSegment]     = useState({ status: 'new' });
  const [preview, setPreview]     = useState(null); // { total, reachable_by_email, reachable_by_phone }
  const [previewing, setPreviewing] = useState(false);
  const [options, setOptions]     = useState({ batches: [], files: [], stages: [], states: [], makes: [], years: [], labels: [] });

  useEffect(() => {
    api.get('/lead_filter_options').then((r) => setOptions(r.data)).catch(() => {});
  }, []);

  // Load templates scoped to the chosen channel whenever it changes.
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

  // Live preview count for step 3.
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

  // Debounce segment changes → preview.
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
      <div className="section-header">
        <div>
          <h1 className="section-title">New campaign</h1>
          <p className="section-subtitle">Send a marketing message to a segment of leads.</p>
        </div>
        <div className="section-actions">
          <button className="vv-btn vv-btn-ghost vv-btn-md" onClick={() => nav('/marketing')}>&larr; Back</button>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-6">
        {STEPS.map((s, i) => {
          const idx  = STEPS.findIndex((x) => x.key === step);
          const done = i < idx;
          const cur  = i === idx;
          return (
            <div key={s.key} className="flex items-center flex-1">
              <button
                onClick={() => i <= idx && setStep(s.key)}
                className={`flex items-center gap-2 text-xs font-medium ${cur ? 'text-fuchsia-700' : done ? 'text-gray-600' : 'text-gray-300'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${cur ? 'bg-fuchsia-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {done ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < idx ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {step === 'basics' && (
          <div className="space-y-5">
            <LabeledField label="Campaign name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q2 nurture — 2015–2018 Camrys"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none"
              />
            </LabeledField>
            <LabeledField label="Channel">
              <div className="grid grid-cols-3 gap-2">
                {MARKETING_CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setChannel(c.key)}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      channel === c.key
                        ? 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
              {channel !== 'email' && (
                <p className="text-[11px] text-amber-700 mt-2">
                  SMS and WhatsApp are simulated in Phase 1 — sends are logged but not actually delivered until a provider is configured.
                </p>
              )}
            </LabeledField>
          </div>
        )}

        {step === 'template' && (
          <div className="space-y-5">
            <LabeledField label="Start from a saved template (optional)">
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none"
              >
                <option value="">— Write from scratch —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </LabeledField>
            {channel === 'email' && (
              <LabeledField label="Subject">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick question about your {{vehicle}}"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none"
                />
              </LabeledField>
            )}
            <LabeledField label="Body">
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Hi {{first_name}},\n\nWe're buying cars like your {{vehicle}} right now…`}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none font-mono text-[13px]"
              />
              <p className="text-[11px] text-gray-500 mt-1.5">
                Available variables: <code className="text-[11px]">{'{{first_name}} {{last_name}} {{full_name}} {{vehicle}} {{vin}} {{city}} {{state}}'}</code>.
                An unsubscribe footer is added automatically.
              </p>
            </LabeledField>
            <LabeledField label="Sender identity (optional)">
              <input
                type="text"
                value={senderIdentity}
                onChange={(e) => setSenderIdentity(e.target.value)}
                placeholder={channel === 'email' ? '"Your Name" <you@your-domain.com>' : 'Your SMS sender / WhatsApp number'}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none"
              />
            </LabeledField>
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Preview (sample data)</div>
              {channel === 'email' && <div className="text-[13px] font-semibold text-gray-900 mb-2">{renderPreview(subject, SAMPLE_VARS) || <span className="text-gray-300">(no subject)</span>}</div>}
              <div className="whitespace-pre-wrap text-[13px] text-gray-700">{renderPreview(body, SAMPLE_VARS) || <span className="text-gray-300">(no body)</span>}</div>
            </div>
          </div>
        )}

        {step === 'recipients' && (
          <div className="space-y-5">
            {/* Quick presets — the two workflows we know people want. */}
            <div className="rounded-xl bg-sky-50 border border-sky-100 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-700 mb-2">Quick presets</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSegment({ lead_temperature: 'cold' })}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-sky-300 bg-white text-sky-700 hover:bg-sky-100"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  Cold leads pool
                </button>
                <button
                  onClick={() => setSegment({ status: 'marketing' })}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-fuchsia-300 bg-white text-fuchsia-700 hover:bg-fuchsia-100"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" />
                  In "Marketing" status
                </button>
                <button
                  onClick={() => setSegment({ tier: 'tier_3', lead_temperature: 'cold' })}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Tier 3 + Cold
                </button>
                <button
                  onClick={() => setSegment({})}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                >
                  Reset filters
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 -mb-1">Or narrow the segment with the filters below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
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

            {/* Live preview */}
            <div className="rounded-xl bg-gradient-to-br from-fuchsia-50 to-pink-50 border border-fuchsia-100 p-4">
              {previewing ? (
                <div className="text-sm text-gray-500">Counting…</div>
              ) : preview ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-2xl font-bold text-gray-900 tabular-nums">
                      {reachable.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600">
                      of {preview.total.toLocaleString()} matching leads are reachable by <span className="font-medium">{channel}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-500 space-y-0.5 text-right">
                    <div>Capped at 500 per campaign in Phase 1</div>
                    <div>Opted-out recipients will be skipped automatically</div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">Adjust filters to see a count.</div>
              )}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <Row label="Name">{name}</Row>
            <Row label="Channel">{MARKETING_CHANNELS.find((c) => c.key === channel)?.label}</Row>
            {channel === 'email' && <Row label="Subject">{renderPreview(subject, SAMPLE_VARS) || <span className="text-gray-300">—</span>}</Row>}
            <Row label="Body">
              <div className="whitespace-pre-wrap text-[13px] text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100">
                {renderPreview(body, SAMPLE_VARS)}
              </div>
            </Row>
            <Row label="Segment">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(segment).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 bg-fuchsia-50 text-fuchsia-700 text-[11px] font-medium px-2 py-1 rounded-md border border-fuchsia-100">
                    {k}: <span className="font-semibold">{String(v)}</span>
                  </span>
                ))}
                {Object.values(segment).every((v) => v === '' || v == null) && <span className="text-[11px] text-gray-400">All leads</span>}
              </div>
            </Row>
            <Row label="Recipients">
              {preview ? (
                <span className="text-sm text-gray-700">{(reachable ?? 0).toLocaleString()} reachable / {preview.total.toLocaleString()} matching</span>
              ) : <span className="text-sm text-gray-400">—</span>}
            </Row>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
          <button
            onClick={() => go(-1)}
            disabled={step === STEPS[0].key || submitting}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 disabled:opacity-40"
          >
            ← Back
          </button>
          {step !== 'review' ? (
            <button
              onClick={() => go(1)}
              disabled={!canNext}
              className="px-5 py-2 text-sm font-medium bg-fuchsia-600 text-white rounded-lg hover:bg-fuchsia-700 disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => submit(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100 disabled:opacity-40"
              >
                Save as draft
              </button>
              <button
                onClick={() => submit(true)}
                disabled={submitting}
                className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white rounded-lg shadow-lg shadow-fuchsia-500/25 disabled:opacity-40"
              >
                {submitting ? 'Creating…' : `Send now${reachable ? ` (${reachable})` : ''}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SegSelect({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 items-start">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 pt-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
