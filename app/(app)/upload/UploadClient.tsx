'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { parseCsvText } from '@/lib/csv';
import { CsvBusinessInput, ImportResult, Workspace } from '@/lib/types';

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function uniqueRows(rows: CsvBusinessInput[]) {
  const map = new Map<string, CsvBusinessInput>();
  for (const row of rows) if (row.normalized_key && !map.has(row.normalized_key)) map.set(row.normalized_key, row);
  return [...map.values()];
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

export default function UploadClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CsvBusinessInput[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('Choose a CSV file to begin.');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setErrors([]);
    if (!file) return;
    setFileName(file.name);
    setProgress('Reading CSV...');
    const text = await file.text();
    const parsed = await parseCsvText(text);
    setRows(parsed.rows);
    setHeaders(parsed.headers);
    setErrors(parsed.errors);
    setProgress(`Preview ready: ${parsed.rows.length.toLocaleString()} usable row(s).`);
  }

  async function fetchExistingKeys(table: 'businesses' | 'scout_history', keys: string[]) {
    const found = new Set<string>();
    for (const part of chunk(keys, 50)) {
      const { data, error } = await supabase
        .from(table)
        .select('normalized_key')
        .eq('workspace_id', workspace.id)
        .in('normalized_key', part);
      if (error) throw error;
      for (const item of data || []) found.add(item.normalized_key);
    }
    return found;
  }

  async function importRows() {
    if (!rows.length || importing) return;
    setImporting(true);
    setResult(null);
    setErrors([]);
    try {
      const deduped = uniqueRows(rows);
      setProgress(`Preparing ${deduped.length.toLocaleString()} unique business(es)...`);
      const keys = deduped.map((row) => row.normalized_key);

      setProgress(`Checking current pending queue in safe batches (${keys.length.toLocaleString()} key(s))...`);
      const queueKeys = await fetchExistingKeys('businesses', keys);

      setProgress('Checking team scouted history in safe batches...');
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
          skipped_count: skippedRows.length,
          headers,
          created_by: userData.user.id
        })
        .select('id')
        .single();
      if (batchError) throw batchError;

      let inserted = 0;
      let index = 0;
      for (const part of chunk(fresh, 300)) {
        index += part.length;
        setProgress(`Importing ${Math.min(index, fresh.length).toLocaleString()} / ${fresh.length.toLocaleString()}...`);
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
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await supabase.from('import_batches').update({ inserted_count: inserted, skipped_count: skippedRows.length }).eq('id', batch.id);
      setResult({
        uploaded: rows.length,
        inserted,
        skippedExistingQueue: skippedRows.filter((row) => queueKeys.has(row.normalized_key)).length,
        skippedScouted: skippedRows.filter((row) => historyKeys.has(row.normalized_key)).length,
        skippedBadRows: rows.length - deduped.length,
        skippedRows,
        batchId: batch.id
      });
      setProgress(`Done. Imported ${inserted.toLocaleString()} new business(es).`);
    } catch (error) {
      const message = formatImportError(error);
      console.error('Scout v8 import failed:', error);
      setErrors([message]);
      setProgress('Import failed. See error below.');
    } finally {
      setImporting(false);
    }
  }

  function downloadSkipped() {
    if (!result?.skippedRows.length) return;
    const headers = Object.keys(result.skippedRows[0].raw || {});
    const lines = [headers.join(',')];
    for (const row of result.skippedRows) {
      lines.push(headers.map((h) => JSON.stringify(String(row.raw[h] ?? ''))).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skipped-duplicates.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <div className="card" style={{ padding: 18 }}>
        <label className="label">Upload CSV</label>
        <input className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
        <p className="muted">Extension exports can be uploaded here. The app dedupes against current queue and team scout history before import.</p>
        <div className="notice">{progress}</div>
        <div className="actions">
          <button className="btn" disabled={!rows.length || importing} onClick={importRows}>
            {importing ? 'Importing...' : `Import ${rows.length.toLocaleString()} Businesses`}
          </button>
          {result?.skippedRows.length ? <button className="btn secondary" onClick={downloadSkipped}>Download skipped duplicates</button> : null}
        </div>
      </div>

      {errors.length ? <div className="error">{errors.join(' | ')}</div> : null}

      {result ? (
        <div className="grid grid-4">
          <div className="card kpi"><div className="title">Uploaded</div><div className="num">{result.uploaded}</div></div>
          <div className="card kpi"><div className="title">Imported</div><div className="num">{result.inserted}</div></div>
          <div className="card kpi"><div className="title">Already In Queue</div><div className="num">{result.skippedExistingQueue}</div></div>
          <div className="card kpi"><div className="title">Already Scouted</div><div className="num">{result.skippedScouted}</div></div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Preview</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Website</th><th>Category</th><th>Location</th><th>Dedupe Key</th></tr></thead>
              <tbody>
                {rows.slice(0, 25).map((row, idx) => (
                  <tr key={`${row.normalized_key}-${idx}`}>
                    <td>{row.name || '-'}</td>
                    <td>{row.email || '-'}</td>
                    <td>{row.website || '-'}</td>
                    <td>{row.category || '-'}</td>
                    <td>{row.location || '-'}</td>
                    <td><code>{row.normalized_key}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Showing first 25 rows only.</p>
        </div>
      ) : null}
    </div>
  );
}
