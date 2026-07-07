'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { parseCsvText } from '@/lib/csv';
import { CsvBusinessInput, ImportResult, Workspace } from '@/lib/types';

const MAX_IMPORT_ROWS = 100000;
const DUPLICATE_CHECK_CHUNK = 75;
const INSERT_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function uniqueRows(rows: CsvBusinessInput[]) {
  const map = new Map<string, CsvBusinessInput>();
  let duplicateRows = 0;
  for (const row of rows) {
    if (!row.normalized_key) continue;
    if (map.has(row.normalized_key)) duplicateRows++;
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

function downloadCsv(name: string, rows: CsvBusinessInput[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0].raw || {});
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => JSON.stringify(String(row.raw[h] ?? ''))).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UploadClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CsvBusinessInput[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('Choose a CSV file to begin. Limit: 100,000 usable rows per import.');
  const [importing, setImporting] = useState(false);
  const [enqueueResearch, setEnqueueResearch] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setErrors([]);
    setRows([]);
    setHeaders([]);
    if (!file) return;
    setFileName(file.name);
    setProgress('Reading CSV. Large files may take a moment...');
    const text = await file.text();
    const parsed = await parseCsvText(text);
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      setProgress(`File has ${parsed.rows.length.toLocaleString()} usable rows. Split it or reduce it to ${MAX_IMPORT_ROWS.toLocaleString()} rows before import.`);
      setErrors([`Import limit is ${MAX_IMPORT_ROWS.toLocaleString()} usable rows per file. This file has ${parsed.rows.length.toLocaleString()}.`]);
      setRows(parsed.rows.slice(0, 100));
      setHeaders(parsed.headers);
      return;
    }
    setRows(parsed.rows);
    setHeaders(parsed.headers);
    setErrors(parsed.errors);
    setProgress(`Preview ready: ${parsed.rows.length.toLocaleString()} usable row(s). Import is chunked to avoid browser/Supabase overload.`);
  }

  async function fetchExistingKeys(table: 'businesses' | 'scout_history', keys: string[]) {
    const found = new Set<string>();
    let checked = 0;
    for (const part of chunk(keys, DUPLICATE_CHECK_CHUNK)) {
      checked += part.length;
      setProgress(`Checking ${table.replace('_', ' ')} duplicates: ${checked.toLocaleString()} / ${keys.length.toLocaleString()}...`);
      const { data, error } = await supabase
        .from(table)
        .select('normalized_key')
        .eq('workspace_id', workspace.id)
        .in('normalized_key', part);
      if (error) throw error;
      for (const item of data || []) found.add(item.normalized_key);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return found;
  }

  async function enqueueImportedResearch(batchId: string) {
    const response = await fetch('/api/research/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.id, limit: 10000, importBatchId: batchId })
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Could not enqueue background email research.');
    return Number(json.enqueued || 0);
  }

  async function importRows() {
    if (!rows.length || importing) return;
    if (rows.length > MAX_IMPORT_ROWS) {
      setErrors([`Import limit is ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split the file before importing.`]);
      return;
    }

    setImporting(true);
    setResult(null);
    setErrors([]);
    try {
      const dedupe = uniqueRows(rows);
      const deduped = dedupe.rows;
      setProgress(`Preparing ${deduped.length.toLocaleString()} unique business(es). Removed ${dedupe.duplicateRows.toLocaleString()} duplicate row(s) inside the file...`);
      const keys = deduped.map((row) => row.normalized_key);

      const queueKeys = await fetchExistingKeys('businesses', keys);
      const historyKeys = await fetchExistingKeys('scout_history', keys);

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
          skipped_count: skippedRows.length + dedupe.duplicateRows,
          headers,
          created_by: userData.user.id
        })
        .select('id')
        .single();
      if (batchError) throw batchError;

      let inserted = 0;
      let seen = 0;
      for (const part of chunk(fresh, INSERT_CHUNK)) {
        seen += part.length;
        setProgress(`Importing ${seen.toLocaleString()} / ${fresh.length.toLocaleString()} fresh business(es)...`);
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
        const { data, error } = await supabase.from('businesses').upsert(payload, {
          onConflict: 'workspace_id,normalized_key',
          ignoreDuplicates: true
        }).select('id');
        if (error) throw error;
        inserted += data?.length || 0;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      let queuedResearch = 0;
      if (enqueueResearch && inserted > 0) {
        setProgress('Import saved. Queueing background email research jobs...');
        queuedResearch = await enqueueImportedResearch(batch.id);
      }

      await supabase.from('import_batches').update({ inserted_count: inserted, skipped_count: skippedRows.length + dedupe.duplicateRows }).eq('id', batch.id);
      setResult({
        uploaded: rows.length,
        inserted,
        skippedExistingQueue: skippedRows.filter((row) => queueKeys.has(row.normalized_key)).length,
        skippedScouted: skippedRows.filter((row) => historyKeys.has(row.normalized_key)).length,
        skippedBadRows: rows.length - deduped.length,
        skippedRows,
        batchId: batch.id,
        queuedResearch
      });
      setProgress(`Done. Imported ${inserted.toLocaleString()} new business(es).${queuedResearch ? ` Queued ${queuedResearch.toLocaleString()} research job(s).` : ''}`);
    } catch (error) {
      const message = formatImportError(error);
      console.error('Scout v8.1 import failed:', error);
      setErrors([message]);
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
        <p className="muted">Limit: 100,000 usable rows per import. The importer dedupes in safe batches, inserts in chunks, and never sends one huge Supabase URL query.</p>
        <div className="notice">{progress}</div>
        <label className="checkbox-row">
          <input type="checkbox" checked={enqueueResearch} onChange={(e) => setEnqueueResearch(e.target.checked)} />
          Queue background email research after import
        </label>
        <div className="actions">
          <button className="btn" disabled={!rows.length || importing || rows.length > MAX_IMPORT_ROWS} onClick={importRows}>
            {importing ? 'Importing...' : `Import ${rows.length.toLocaleString()} Businesses`}
          </button>
          {result?.skippedRows.length ? <button className="btn secondary" onClick={() => downloadCsv('skipped-duplicates.csv', result.skippedRows)}>Download skipped duplicates</button> : null}
        </div>
      </div>

      {errors.length ? <div className="error">{errors.join(' | ')}</div> : null}

      {result ? (
        <div className="grid grid-4">
          <div className="card kpi"><div className="title">Uploaded</div><div className="num">{result.uploaded.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Imported</div><div className="num">{result.inserted.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Already In Queue</div><div className="num">{result.skippedExistingQueue.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Already Scouted</div><div className="num">{result.skippedScouted.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Bad/Duplicate Rows</div><div className="num">{result.skippedBadRows.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Research Jobs</div><div className="num">{(result.queuedResearch || 0).toLocaleString()}</div></div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Preview</h3>
          <p className="muted">Showing first 25 rows only. Large imports are stored in Supabase, not rendered all at once.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Website</th><th>Category</th><th>Location</th><th>Dedupe Key</th></tr></thead>
              <tbody>
                {rows.slice(0, 25).map((row, idx) => (
                  <tr key={`${row.normalized_key}-${idx}`}>
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
