'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { csvColumnsLookDifferent, parseCsvText } from '@/lib/csv';
import { CsvBusinessInput, CsvInvalidRow, ExistingKeyRecord, ImportResult, Workspace } from '@/lib/types';

const MAX_IMPORT_ROWS = 100000;
const DUPLICATE_CHECK_CHUNK = 1000;
const INSERT_CHUNK = 500;
const ACTIVE_QUEUE_STATUSES = ['pending', 'scanning', 'found', 'ready', 'review'];

type ImportPhase = 'idle' | 'reading' | 'ready' | 'checking' | 'importing' | 'done' | 'failed';

type TargetWarning = {
  activeCount: number;
  previousHeaders: string[];
  newHeaders: string[];
} | null;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function uniqueRows(rows: CsvBusinessInput[]) {
  const map = new Map<string, CsvBusinessInput>();
  const duplicateRows: CsvBusinessInput[] = [];
  for (const row of rows) {
    if (!row.normalized_key) continue;
    if (map.has(row.normalized_key)) duplicateRows.push(row);
    else map.set(row.normalized_key, row);
  }
  return { rows: [...map.values()], duplicateRows };
}

function formatImportError(error: unknown) {
  if (!error) return 'Unknown import error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error_description?: string; };
    const parts = [
      value.message || value.error_description,
      value.code ? `Code: ${value.code}` : '',
      value.details ? `Details: ${value.details}` : '',
      value.hint ? `Hint: ${value.hint}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadRawRows(name: string, rows: Array<{ raw: Record<string, unknown> }>) {
  if (!rows.length) return;
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row.raw || {}).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row.raw[h])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadInvalidRows(name: string, rows: CsvInvalidRow[]) {
  if (!rows.length) return;
  const rawHeaders = Array.from(rows.reduce((set, row) => {
    Object.keys(row.raw || {}).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const headers = ['rowNumber', 'reason', ...rawHeaders];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push([row.rowNumber, row.reason, ...rawHeaders.map((h) => row.raw[h])].map(csvEscape).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function UploadClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CsvBusinessInput[]>([]);
  const [invalidRows, setInvalidRows] = useState<CsvInvalidRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('Choose a CSV file to begin. Limit: 100,000 usable rows per import.');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [percent, setPercent] = useState(0);
  const [importing, setImporting] = useState(false);
  const [enqueueResearch, setEnqueueResearch] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [targetWarning, setTargetWarning] = useState<TargetWarning>(null);
  const [allowDifferentTarget, setAllowDifferentTarget] = useState(false);

  async function checkTargetMismatch(nextHeaders: string[]) {
    setTargetWarning(null);
    setAllowDifferentTarget(false);
    const { count, error: countError } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .in('status', ACTIVE_QUEUE_STATUSES);
    if (countError) throw countError;
    const activeCount = count || 0;
    if (!activeCount) return;

    const { data, error } = await supabase
      .from('import_batches')
      .select('headers')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const previousHeaders = Array.isArray(data?.headers) ? data.headers : [];
    if (csvColumnsLookDifferent(previousHeaders, nextHeaders)) {
      setTargetWarning({ activeCount, previousHeaders, newHeaders: nextHeaders });
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setErrors([]);
    setRows([]);
    setInvalidRows([]);
    setHeaders([]);
    setPercent(0);
    setPhase('idle');
    if (!file) return;

    setFileName(file.name);
    setPhase('reading');
    setProgress('Reading CSV and extracting businesses from all columns...');
    try {
      const text = await file.text();
      const parsed = await parseCsvText(text);
      setHeaders(parsed.headers);
      setInvalidRows(parsed.invalidRows);
      setErrors(parsed.errors);

      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        setRows(parsed.rows.slice(0, 100));
        setPhase('failed');
        setProgress(`File has ${parsed.rows.length.toLocaleString()} usable rows. Limit is ${MAX_IMPORT_ROWS.toLocaleString()} rows per import.`);
        setErrors((current) => [`Import limit is ${MAX_IMPORT_ROWS.toLocaleString()} usable rows per file. This file has ${parsed.rows.length.toLocaleString()}.`, ...current]);
        return;
      }

      await checkTargetMismatch(parsed.headers);
      setRows(parsed.rows);
      setPhase('ready');
      setProgress(`Preview ready: ${parsed.rows.length.toLocaleString()} usable row(s), ${parsed.invalidRows.length.toLocaleString()} invalid row(s). Import will run in safe chunks.`);
    } catch (error) {
      setPhase('failed');
      setErrors([formatImportError(error)]);
      setProgress('File could not be read. See error below.');
    }
  }

  async function fetchExistingKeys(keys: string[]) {
    const queueKeys = new Set<string>();
    const historyKeys = new Set<string>();
    let checked = 0;
    for (const part of chunk(keys, DUPLICATE_CHECK_CHUNK)) {
      checked += part.length;
      setPhase('checking');
      setPercent(Math.min(45, Math.round((checked / Math.max(keys.length, 1)) * 45)));
      setProgress(`Checking team duplicates: ${checked.toLocaleString()} / ${keys.length.toLocaleString()}...`);
      const { data, error } = await supabase.rpc('check_existing_normalized_keys', {
        target_workspace: workspace.id,
        normalized_keys: part
      });
      if (error) throw error;
      for (const item of (data || []) as ExistingKeyRecord[]) {
        if (item.source === 'scout_history') historyKeys.add(item.normalized_key);
        else queueKeys.add(item.normalized_key);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { queueKeys, historyKeys };
  }

  async function enqueueImportedResearch(batchId: string) {
    const response = await fetch('/api/research/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.id, limit: 10000, importBatchId: batchId })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) throw new Error(json.error || 'Could not enqueue background email research.');
    return Number(json.enqueued || 0);
  }

  async function importRows() {
    if (!rows.length || importing) return;
    if (targetWarning && !allowDifferentTarget) {
      setErrors(['This looks like a different target list while unfinished businesses still exist. Tick “Import anyway” if you want to continue.']);
      return;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      setErrors([`Import limit is ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split the file before importing.`]);
      return;
    }

    setImporting(true);
    setResult(null);
    setErrors([]);
    setPercent(0);
    try {
      const { rows: deduped, duplicateRows } = uniqueRows(rows);
      setProgress(`Preparing ${deduped.length.toLocaleString()} unique business(es). Removed ${duplicateRows.length.toLocaleString()} duplicate row(s) inside the file...`);
      const keys = deduped.map((row) => row.normalized_key);
      const { queueKeys, historyKeys } = await fetchExistingKeys(keys);

      const skippedRows: CsvBusinessInput[] = [];
      const fresh = deduped.filter((row) => {
        const exists = queueKeys.has(row.normalized_key) || historyKeys.has(row.normalized_key);
        if (exists) skippedRows.push(row);
        return !exists;
      });

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error('Not signed in.');

      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          workspace_id: workspace.id,
          file_name: fileName || 'csv_upload.csv',
          row_count: rows.length,
          inserted_count: 0,
          skipped_count: skippedRows.length + duplicateRows.length + invalidRows.length,
          headers,
          created_by: userData.user.id
        })
        .select('id')
        .single();
      if (batchError) throw batchError;

      let inserted = 0;
      let processed = 0;
      setPhase('importing');
      for (const part of chunk(fresh, INSERT_CHUNK)) {
        processed += part.length;
        setPercent(45 + Math.min(50, Math.round((processed / Math.max(fresh.length, 1)) * 50)));
        setProgress(`Importing ${processed.toLocaleString()} / ${fresh.length.toLocaleString()} fresh business(es)...`);
        const payload = part.map((row) => ({
          workspace_id: workspace.id,
          import_batch_id: batch.id,
          name: row.name || null,
          email: row.email || null,
          phone: row.phone || null,
          website: row.website || null,
          domain: row.domain || null,
          category: row.category || null,
          location: row.location || null,
          source: row.source || 'csv_upload',
          status: 'pending',
          score: null,
          normalized_key: row.normalized_key,
          raw: row.raw,
          created_by: userData.user.id
        }));
        const { data, error } = await supabase
          .from('businesses')
          .upsert(payload, { onConflict: 'workspace_id,normalized_key', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        inserted += data?.length || 0;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      let queuedResearch = 0;
      if (enqueueResearch && inserted > 0) {
        setProgress('Import saved. Queueing background email research jobs...');
        queuedResearch = await enqueueImportedResearch(batch.id);
      }

      await supabase
        .from('import_batches')
        .update({ inserted_count: inserted, skipped_count: skippedRows.length + duplicateRows.length + invalidRows.length })
        .eq('id', batch.id);

      setResult({
        uploaded: rows.length,
        inserted,
        skippedExistingQueue: skippedRows.filter((row) => queueKeys.has(row.normalized_key)).length,
        skippedScouted: skippedRows.filter((row) => historyKeys.has(row.normalized_key)).length,
        skippedFileDuplicates: duplicateRows.length,
        invalidRows,
        skippedRows,
        batchId: batch.id,
        queuedResearch
      });
      setPercent(100);
      setPhase('done');
      setProgress(`Done. Imported ${inserted.toLocaleString()} new business(es).${queuedResearch ? ` Queued ${queuedResearch.toLocaleString()} research job(s).` : ''}`);
    } catch (error) {
      const message = formatImportError(error);
      console.error('Scout v8.3 import failed:', error);
      setErrors([message]);
      setPhase('failed');
      setProgress('Import failed. See the real error below.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="stack">
      <div className="card" style={{ padding: 18 }}>
        <label className="label">Upload CSV</label>
        <input className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
        <p className="muted">Limit: 100,000 usable rows per import. Scout extracts email, website/domain, phone, name, category, and location from known columns and fallback cell scanning.</p>
        <div className={phase === 'failed' ? 'error' : phase === 'done' ? 'success' : 'notice'}>{progress}</div>
        <div className="progress-track" aria-label="Import progress"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>

        {targetWarning ? (
          <div className="error">
            <strong>Different target warning:</strong> You still have {targetWarning.activeCount.toLocaleString()} unfinished business(es) in the queue, and this file looks like a different target list. Finish/send the current batch first, or tick the confirmation below.
            <label className="checkbox-row" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={allowDifferentTarget} onChange={(event) => setAllowDifferentTarget(event.target.checked)} />
              Import anyway — I understand this may mix different campaigns.
            </label>
          </div>
        ) : null}

        <label className="checkbox-row">
          <input type="checkbox" checked={enqueueResearch} onChange={(event) => setEnqueueResearch(event.target.checked)} />
          Queue background email research after import
        </label>

        <div className="actions">
          <button className="btn" disabled={!rows.length || importing || rows.length > MAX_IMPORT_ROWS} onClick={importRows}>
            {importing ? 'Importing...' : `Import ${rows.length.toLocaleString()} business(es)`}
          </button>
          {invalidRows.length ? <button className="btn secondary" type="button" onClick={() => downloadInvalidRows('scout-invalid-rows.csv', invalidRows)}>Download invalid rows</button> : null}
          {result?.skippedRows.length ? <button className="btn secondary" type="button" onClick={() => downloadRawRows('scout-skipped-duplicates.csv', result.skippedRows)}>Download skipped duplicates</button> : null}
        </div>
      </div>

      {errors.length ? <div className="error"><strong>Import note:</strong><br />{errors.map((error, index) => <div key={index}>{error}</div>)}</div> : null}

      {result ? (
        <div className="grid grid-4">
          <div className="card kpi"><div className="title">Uploaded</div><div className="num">{result.uploaded.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Imported</div><div className="num">{result.inserted.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Already In Queue</div><div className="num">{result.skippedExistingQueue.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Already Scouted</div><div className="num">{result.skippedScouted.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">File Duplicates</div><div className="num">{result.skippedFileDuplicates.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Invalid Rows</div><div className="num">{result.invalidRows.length.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Research Jobs</div><div className="num">{(result.queuedResearch || 0).toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Batch ID</div><div className="num" style={{ fontSize: 12, wordBreak: 'break-all' }}>{result.batchId || '-'}</div></div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Preview</h3>
          <p className="muted">Showing first 25 rows only. Large imports are stored in Supabase and rendered separately in the Businesses page.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Website</th><th>Category</th><th>Location</th><th>Dedupe Key</th></tr></thead>
              <tbody>
                {rows.slice(0, 25).map((row, index) => (
                  <tr key={`${row.normalized_key}-${index}`}>
                    <td>{row.name || '-'}</td>
                    <td>{row.email || '-'}</td>
                    <td>{row.website || row.domain || '-'}</td>
                    <td>{row.category || '-'}</td>
                    <td>{row.location || '-'}</td>
                    <td>{row.normalized_key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
