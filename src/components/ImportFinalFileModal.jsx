import { useState, useEffect, useMemo, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { NORMALIZED_FIELDS, suggestFieldForHeader } from '../lib/normalizedFields';

// Default each header to a known normalized field if we can recognize it,
// otherwise keep the column under its original name (identity mapping).
function suggestOrIdentity(header) {
  const suggested = suggestFieldForHeader(header);
  return suggested === '_ignore' ? header : suggested;
}

const PREVIEW_ROW_LIMIT = 15;

function pickLatestTloArtifact(file) {
  const tlo = file?.artifacts_by_stage?.tlo || [];
  if (tlo.length === 0) return null;
  return [...tlo].sort((a, b) => b.id - a.id)[0];
}

export default function ImportFinalFileModal({ file, onClose, onImported }) {
  const artifact = useMemo(() => pickLatestTloArtifact(file), [file]);
  const [phase, setPhase] = useState('parsing'); // parsing | mapping | importing | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);       // [{ row_number, raw: {header: value} }]
  const [mapping, setMapping] = useState({}); // { header: normalizedKey }
  const [warnings, setWarnings] = useState([]);
  const [parseError, setParseError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [batchName, setBatchName] = useState('');
  const [notes, setNotes] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [rowFilters, setRowFilters] = useState([]); // [{ column, value }]

  // Parse the artifact once the modal opens.
  useEffect(() => {
    if (!file || !artifact) return;
    let cancelled = false;
    (async () => {
      setPhase('parsing');
      setParseError('');
      try {
        const [XLSX, res] = await Promise.all([
          import('xlsx'),
          api.get('/upload', { params: { artifact_id: artifact.id }, responseType: 'arraybuffer' }),
        ]);
        if (cancelled) return;
        // cellStyles: true is required for xlsx to populate sheet['!rows'] with
        // each row's hidden flag — without it, AutoFilter-hidden rows look visible.
        const wb = XLSX.read(res.data, { type: 'array', cellStyles: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error('Spreadsheet has no sheets');
        const sheet = wb.Sheets[sheetName];

        // Respect Excel row hiding: AutoFilter, manual hide, "Hide rows" all
        // mark metadata on sheet['!rows'][i].hidden. xlsx's sheet_to_json
        // ignores this flag, so we collect hidden indices and skip them.
        const hiddenRows = new Set();
        (sheet['!rows'] || []).forEach((m, idx) => {
          if (m && m.hidden) hiddenRows.add(idx);
        });

        // blankrows: true so aoa indices align with original sheet row numbers
        // (0-based: aoa[0] is the header row, aoa[i] is sheet row i+1 in Excel).
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: false });
        if (aoa.length === 0) throw new Error('Sheet is empty');

        const rawHeaders = (aoa[0] || []).map((h) => (h == null ? '' : String(h).trim()));
        const seen = new Map();
        const dedupedHeaders = rawHeaders.map((h, i) => {
          const base = h || `Column ${i + 1}`;
          const count = seen.get(base) || 0;
          seen.set(base, count + 1);
          return count === 0 ? base : `${base} (${count + 1})`;
        });
        const warn = [];
        if (rawHeaders.some((h) => h === '')) warn.push('Some header cells were blank; replaced with "Column N".');
        if (dedupedHeaders.length !== new Set(rawHeaders).size && rawHeaders.some((h) => h !== '')) {
          warn.push('Duplicate header names were suffixed with (2), (3), etc.');
        }

        const parsedRows = [];
        let emptyRows = 0;
        let hiddenSkipped = 0;
        for (let i = 1; i < aoa.length; i++) {
          if (hiddenRows.has(i)) { hiddenSkipped++; continue; }
          const row = aoa[i] || [];
          const isEmpty = dedupedHeaders.every((_, j) => {
            const v = row[j];
            return v === undefined || v === null || String(v).trim() === '';
          });
          if (isEmpty) { emptyRows++; continue; }
          const obj = {};
          dedupedHeaders.forEach((h, j) => {
            const v = row[j];
            obj[h] = v === undefined || v === null ? '' : String(v);
          });
          parsedRows.push({ row_number: i + 1, raw: obj });
        }
        if (hiddenSkipped > 0) warn.push(`Skipped ${hiddenSkipped} row${hiddenSkipped === 1 ? '' : 's'} hidden by an Excel filter.`);
        if (emptyRows > 0) warn.push(`Skipped ${emptyRows} empty row${emptyRows === 1 ? '' : 's'}.`);

        // First header that suggests a given normalized field claims it.
        // Subsequent headers that would map to the same field fall back to
        // identity (kept as their raw column name) so no data is lost to
        // last-wins overwrites. Example: Phone Number 1 -> phone_primary,
        // Phone Number 2/3/4 -> "Phone Number 2"/"3"/"4" (kept as-is).
        const suggested = {};
        const claimed = new Set();
        dedupedHeaders.forEach((h) => {
          const s = suggestOrIdentity(h);
          if (s !== h && claimed.has(s)) {
            suggested[h] = h;
          } else {
            suggested[h] = s;
            if (s !== h) claimed.add(s);
          }
        });

        setHeaders(dedupedHeaders);
        setRows(parsedRows);
        setMapping(suggested);
        setWarnings(warn);
        setBatchName((prev) => prev || `${file.display_name || file.file_name} · ${artifact.original_filename}`);
        setPhase('mapping');
      } catch (err) {
        if (!cancelled) {
          setParseError(err?.message || 'Failed to parse spreadsheet');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [file, artifact]);

  // Load mapping templates for TLO stage.
  useEffect(() => {
    let cancelled = false;
    api.get('/mapping_templates', { params: { source_stage: 'tlo', active: 1 } })
      .then((res) => { if (!cancelled) setTemplates(res.data || []); })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  const applyTemplate = useCallback((tplId) => {
    setTemplateId(tplId);
    const tpl = templates.find((t) => String(t.id) === String(tplId));
    if (!tpl) return;
    const next = { ...mapping };
    headers.forEach((h) => {
      if (tpl.mapping_json && tpl.mapping_json[h]) next[h] = tpl.mapping_json[h];
    });
    setMapping(next);
  }, [templates, headers, mapping]);

  const mappedFieldCounts = useMemo(() => {
    const counts = {};
    Object.values(mapping).forEach((f) => { counts[f] = (counts[f] || 0) + 1; });
    return counts;
  }, [mapping]);

  const duplicateFieldWarnings = useMemo(() => {
    return Object.entries(mappedFieldCounts)
      .filter(([f, n]) => f !== '_ignore' && n > 1)
      .map(([f]) => f);
  }, [mappedFieldCounts]);

  // Apply the row filters (if any) to narrow the rows we import.
  // An empty "value" means "must be non-empty"; a set value requires an exact match.
  const activeRowFilters = rowFilters.filter((f) => f.column);
  const filteredRows = useMemo(() => {
    if (activeRowFilters.length === 0) return rows;
    return rows.filter((r) => activeRowFilters.every((f) => {
      const v = r.raw[f.column];
      const s = v == null ? '' : String(v).trim();
      if (f.value === '') return s !== '';
      return s.toLowerCase() === String(f.value).trim().toLowerCase();
    }));
  }, [rows, activeRowFilters]);

  const canImport = batchName.trim().length > 0 && filteredRows.length > 0
    && Object.values(mapping).some((f) => f !== '_ignore');

  const handleImport = async () => {
    if (saveAsTemplate && !newTemplateName.trim()) {
      setSubmitError('Please enter a template name or uncheck "Save as template".');
      return;
    }
    setSubmitting(true); setSubmitError(''); setPhase('importing');
    try {
      let mappingTemplateIdFinal = templateId ? Number(templateId) : null;
      if (saveAsTemplate && newTemplateName.trim()) {
        try {
          const createRes = await api.post('/mapping_templates', {
            template_name: newTemplateName.trim(),
            source_stage:  'tlo',
            mapping_json:  mapping,
            active:        true,
          });
          mappingTemplateIdFinal = createRes.data.id;
        } catch (err) {
          throw new Error(extractApiError(err, 'Failed to save mapping template'));
        }
      }

      const res = await api.post('/lead_imports', {
        file_id:              file.id,
        artifact_id:          artifact.id,
        batch_name:           batchName.trim(),
        mapping_json:         mapping,
        mapping_template_id:  mappingTemplateIdFinal,
        rows:                 filteredRows,
        notes:                notes || null,
      });
      setResult(res.data);
      setPhase('done');
      onImported?.(res.data);
    } catch (err) {
      setSubmitError(extractApiError(err, 'Import failed'));
      setPhase('mapping');
    } finally {
      setSubmitting(false);
    }
  };

  if (!file) return null;

  if (!artifact) {
    return (
      <ModalShell title="Import final file" onClose={onClose}>
        <p className="text-sm text-gray-600">
          This file has no TLO-stage artifact. Upload a final spreadsheet to the TLO stage first.
        </p>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Import final file" onClose={onClose} wide>
      <div className="space-y-5">
        <HeaderCard file={file} artifact={artifact} />

        {phase === 'parsing' && (
          <div className="py-8 text-center">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3">Parsing spreadsheet…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-4 text-sm">
            <p className="font-medium mb-1">Could not parse this file.</p>
            <p className="text-red-600">{parseError}</p>
          </div>
        )}

        {(phase === 'mapping' || phase === 'importing') && (
          <>
            {warnings.length > 0 && (
              <ul className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 space-y-1">
                {warnings.map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            )}

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Batch name" required>
                <input
                  type="text"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="e.g. April TLO batch"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none"
                />
              </Field>
              <Field label="Use mapping template">
                <select
                  value={templateId}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none"
                >
                  <option value="">— No template (manual mapping) —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.template_name}</option>
                  ))}
                </select>
              </Field>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Filter rows</h3>
                <button
                  type="button"
                  onClick={() => setRowFilters([...rowFilters, { column: '', value: '' }])}
                  className="text-[11px] font-medium text-[var(--vv-text)] hover:underline"
                >
                  + Add filter
                </button>
              </div>
              {rowFilters.length === 0 ? (
                <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  No filters — all {rows.length} rows will be imported. Add a filter to narrow down (e.g. only rows where "1 = Interested" equals 1).
                </p>
              ) : (
                <div className="space-y-2">
                  {rowFilters.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={f.column}
                        onChange={(e) => setRowFilters(rowFilters.map((x, i) => i === idx ? { ...x, column: e.target.value } : x))}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                      >
                        <option value="">— choose column —</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-[11px] text-gray-500">equals</span>
                      <input
                        type="text"
                        value={f.value}
                        onChange={(e) => setRowFilters(rowFilters.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))}
                        placeholder="value (or leave blank = non-empty)"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setRowFilters(rowFilters.filter((_, i) => i !== idx))}
                        className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                        aria-label="Remove filter"
                      >×</button>
                    </div>
                  ))}
                  {activeRowFilters.length > 0 && (
                    <p className="text-[11px] text-blue-700">
                      {filteredRows.length} of {rows.length} rows match {activeRowFilters.length === 1 ? 'this filter' : `all ${activeRowFilters.length} filters`}.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Column mapping</h3>
                <span className="text-[11px] text-gray-400">
                  {activeRowFilters.length > 0
                    ? `${filteredRows.length} of ${rows.length} rows match filters`
                    : `${rows.length} data ${rows.length === 1 ? 'row' : 'rows'}`}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-100">
                {headers.map((h) => (
                  <div key={h} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate" title={h}>{h}</p>
                      <p className="text-[11px] text-gray-400 truncate">e.g. {firstNonEmpty(rows, h)}</p>
                    </div>
                    <select
                      value={mapping[h] ?? h}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                      className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none"
                    >
                      <option value={h}>Keep as "{h}"</option>
                      <optgroup label="Map to standard field">
                        {NORMALIZED_FIELDS.filter((f) => f.key !== '_ignore').map((f) => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </optgroup>
                      <option value="_ignore">— Ignore this column —</option>
                    </select>
                  </div>
                ))}
              </div>
              {duplicateFieldWarnings.length > 0 && (
                <p className="text-[11px] text-amber-700 mt-2">
                  Multiple columns mapped to: {duplicateFieldWarnings.join(', ')}. Last-wins order applies.
                </p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Preview (first {Math.min(filteredRows.length, PREVIEW_ROW_LIMIT)} of {filteredRows.length})
              </h3>
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 sticky left-0 bg-gray-50">#</th>
                      {headers.map((h) => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                          {h}
                          {mapping[h] && mapping[h] !== '_ignore' && (
                            <span className="ml-1 text-[10px] font-normal text-[var(--vv-text)] bg-blue-50 px-1 py-0.5 rounded">
                              → {mapping[h]}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, PREVIEW_ROW_LIMIT).map((r) => (
                      <tr key={r.row_number} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-400 sticky left-0 bg-white">{r.row_number}</td>
                        {headers.map((h) => (
                          <td key={h} className="px-2 py-1.5 text-gray-700 whitespace-nowrap">
                            {String(r.raw[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} className="rounded border-gray-300 text-[var(--vv-text)] focus:ring-[var(--vv-bg-dark)]" />
                Save this mapping as a new template
              </label>
              {saveAsTemplate && (
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Template name"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              )}
              <Field label="Notes (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </Field>
            </section>

            {submitError && (
              <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{submitError}</div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!canImport || submitting}
                className="px-5 py-2 text-sm font-medium bg-[var(--vv-bg-dark)] text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Importing…' : `Import ${filteredRows.length} ${filteredRows.length === 1 ? 'row' : 'rows'}`}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && result && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-sm space-y-2">
            <p className="font-semibold text-emerald-800">Import complete.</p>
            <ul className="text-emerald-700 space-y-1 text-xs">
              <li>• Batch ID: {result.batch_id}</li>
              <li>• Total rows: {result.total_rows}</li>
              <li>• Imported: {result.imported_rows}</li>
              <li>• Skipped: {result.skipped_rows}</li>
              <li>• Failed: {result.failed_rows}</li>
            </ul>
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Close</button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function firstNonEmpty(rows, header) {
  for (const r of rows) {
    const v = r.raw[header];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const s = String(v);
      return s.length > 40 ? s.slice(0, 40) + '…' : s;
    }
  }
  return '—';
}

function HeaderCard({ file, artifact }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-xs grid grid-cols-2 gap-y-1.5 gap-x-4">
      <div>
        <p className="font-semibold uppercase tracking-wider text-gray-400">File</p>
        <p className="text-sm text-gray-800 truncate">{file.display_name || file.file_name}</p>
      </div>
      <div>
        <p className="font-semibold uppercase tracking-wider text-gray-400">Vehicle</p>
        <p className="text-sm text-gray-800 truncate">{file.vehicle?.name || file.vehicle_name}</p>
      </div>
      <div>
        <p className="font-semibold uppercase tracking-wider text-gray-400">Artifact</p>
        <p className="text-sm text-gray-800 truncate">{artifact.original_filename}</p>
      </div>
      <div>
        <p className="font-semibold uppercase tracking-wider text-gray-400">Stage</p>
        <p className="text-sm text-gray-800">TLO (final)</p>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function ModalShell({ title, onClose, wide, children }) {
  const width = wide ? 'max-w-4xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/60" />
      <div className={`relative bg-white w-full ${width} sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
