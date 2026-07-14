'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { csvColumnsLookDifferent, parseCsvText } from '@/lib/csv';
import { Business, CsvBusinessInput, CsvInvalidRow, ImportResult, MessageCategory, Workspace } from '@/lib/types';

const MAX_IMPORT_ROWS = 100000;
const SERVER_IMPORT_CHUNK = 5000;
const ACTIVE_QUEUE_STATUSES = ['pending', 'scanning', 'found', 'ready', 'review'];

type ImportPhase = 'idle' | 'reading' | 'ready' | 'checking' | 'importing' | 'done' | 'failed';
type TargetWarning = { activeCount: number; previousHeaders: string[]; newHeaders: string[] } | null;
type ImportChunkResult = { inserted_count: number; skipped_queue_count: number; skipped_history_count: number; skipped_team_count?: number; skipped_keys?: string[] | null };

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
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error_description?: string };
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

function downloadBusinessRows(name: string, businesses: Business[]) {
  if (!businesses.length) return;
  const headers = ['name', 'email', 'phone', 'website', 'domain', 'category', 'location', 'source', 'status', 'score', 'normalized_key', 'created_at', 'updated_at'];
  const lines = [headers.map(csvEscape).join(',')];
  for (const b of businesses) lines.push(headers.map((h) => csvEscape((b as unknown as Record<string, unknown>)[h])).join(','));
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
  for (const row of rows) lines.push([row.rowNumber, row.reason, ...rawHeaders.map((h) => row.raw[h])].map(csvEscape).join(','));
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

function toRpcRows(rows: CsvBusinessInput[]) {
  return rows.map((row) => ({
    name: row.name || null,
    email: row.email || null,
    phone: row.phone || null,
    website: row.website || null,
    domain: row.domain || null,
    category: row.category || null,
    location: row.location || null,
    source: row.source || 'csv_upload',
    normalized_key: row.normalized_key,
    raw: row.raw || {}
  }));
}

export default function UploadClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [audienceCategoryId, setAudienceCategoryId] = useState(workspace.default_audience_category_id || '');
  const [newAudienceCategory, setNewAudienceCategory] = useState(workspace.default_audience_category_name || '');
  const [rows, setRows] = useState<CsvBusinessInput[]>([]);
  const [invalidRows, setInvalidRows] = useState<CsvInvalidRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('Choose a CSV file. Rows with emails go to Ready for Message; rows without emails stay Pending for Auto Scout.');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [percent, setPercent] = useState(0);
  const [importing, setImporting] = useState(false);
  const [enqueueResearch, setEnqueueResearch] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [targetWarning, setTargetWarning] = useState<TargetWarning>(null);
  const [allowDifferentTarget, setAllowDifferentTarget] = useState(false);

  const selectedAudienceCategory = categories.find((c) => c.id === audienceCategoryId) || null;

  async function loadCategories() {
    const { data, error } = await supabase
      .from('message_categories')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    setCategories((data || []) as MessageCategory[]);
  }

  useEffect(() => {
    loadCategories().catch((error) => setErrors([formatImportError(error)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  async function ensureAudienceCategory() {
    if (audienceCategoryId) return { id: audienceCategoryId, name: selectedAudienceCategory?.name || newAudienceCategory.trim() || '' };
    const name = newAudienceCategory.trim();
    if (!name) return { id: '', name: '' };
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('message_categories')
      .upsert({ workspace_id: workspace.id, name, description: 'Audience category created during CSV upload.', active: true, created_by: user?.id || null }, { onConflict: 'workspace_id,name' })
      .select('*')
      .single();
    if (error) throw error;
    setAudienceCategoryId(data.id);
    setNewAudienceCategory(data.name || name);
    await loadCategories();
    return { id: data.id as string, name: String(data.name || name) };
  }

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
    if (csvColumnsLookDifferent(previousHeaders, nextHeaders)) setTargetWarning({ activeCount, previousHeaders, newHeaders: nextHeaders });
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
    setProgress('Reading CSV locally. The app only renders a 25-row preview, so large files should not freeze the page...');
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
      const emailCount = parsed.rows.filter((row) => row.email).length;
      const websiteCount = parsed.rows.filter((row) => row.website || row.domain).length;
      setProgress(`Preview ready: ${parsed.rows.length.toLocaleString()} usable row(s). ${emailCount.toLocaleString()} will go to Ready for Message. ${(parsed.rows.length - emailCount).toLocaleString()} without email will stay Pending for Auto Scout. ${websiteCount.toLocaleString()} have website/domain. ${parsed.invalidRows.length.toLocaleString()} invalid row(s).`);
    } catch (error) {
      setPhase('failed');
      setErrors([formatImportError(error)]);
      setProgress('File could not be read. See error below.');
    }
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
      const startedAt = performance.now();
      const { rows: deduped, duplicateRows } = uniqueRows(rows);
      setPhase('checking');
      setProgress(`Preparing ${deduped.length.toLocaleString()} unique business(es). Removed ${duplicateRows.length.toLocaleString()} duplicate row(s) inside the file.`);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error('Not signed in.');

      const category = await ensureAudienceCategory();

      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          workspace_id: workspace.id,
          file_name: fileName || 'csv_upload.csv',
          row_count: rows.length,
          inserted_count: 0,
          skipped_count: duplicateRows.length + invalidRows.length,
          headers,
          category_id: category.id || null,
          category_name: category.name || null,
          source_mode: 'csv_upload',
          created_by: userData.user.id
        })
        .select('id')
        .single();
      if (batchError) throw batchError;

      let inserted = 0;
      let skippedExistingQueue = 0;
      let skippedScouted = 0;
      let skippedTeam = 0;
      let processed = 0;
      const skippedKeys = new Set<string>();
      setPhase('importing');

      for (const part of chunk(deduped, SERVER_IMPORT_CHUNK)) {
        processed += part.length;
        setPercent(Math.min(95, Math.round((processed / Math.max(deduped.length, 1)) * 95)));
        setProgress(`Fast cloud import: ${processed.toLocaleString()} / ${deduped.length.toLocaleString()} row(s). Server is deduping and inserting in one step...`);
        const { data, error } = await supabase.rpc('import_businesses_chunk_with_category', {
          target_workspace: workspace.id,
          target_batch_id: batch.id,
          input_rows: toRpcRows(part),
          target_category_id: category.id || null,
          target_category_name: category.name || null
        });
        if (error) throw error;
        const item = ((data || []) as ImportChunkResult[])[0];
        inserted += Number(item?.inserted_count || 0);
        skippedExistingQueue += Number(item?.skipped_queue_count || 0);
        skippedScouted += Number(item?.skipped_history_count || 0);
        skippedTeam += Number(item?.skipped_team_count || 0);
        (item?.skipped_keys || []).forEach((key) => skippedKeys.add(key));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const skippedRows = deduped.filter((row) => skippedKeys.has(row.normalized_key));
      let queuedResearch = 0;
      if (enqueueResearch && inserted > 0) {
        setProgress('Import saved. Queueing background email research jobs...');
        queuedResearch = await enqueueImportedResearch(batch.id);
      }

      const skippedTotal = skippedRows.length + duplicateRows.length + invalidRows.length;
      await supabase.from('import_batches').update({ inserted_count: inserted, skipped_count: skippedTotal }).eq('id', batch.id);

      if (skippedTeam > 0) {
        await supabase.from('app_notifications').insert({
          workspace_id: workspace.id,
          type: 'team_duplicate_removed',
          title: 'Team duplicate leads removed',
          message: `${skippedTeam.toLocaleString()} lead${skippedTeam === 1 ? '' : 's'} already scouted by a team member and removed from this upload.`,
          entity_type: 'import_batch',
          entity_id: batch.id,
          raw: { batchId: batch.id, skippedTeam, removedFromUpload: true }
        });
      }

      setResult({ uploaded: rows.length, inserted, skippedExistingQueue, skippedScouted, skippedTeam, skippedFileDuplicates: duplicateRows.length, invalidRows, skippedRows, batchId: batch.id, queuedResearch });
      const seconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
      setPercent(100);
      setPhase('done');
      setProgress(`Done in ${seconds.toFixed(1)}s. Imported ${inserted.toLocaleString()} new business(es), skipped ${skippedTotal.toLocaleString()}.${skippedTeam ? ` ${skippedTeam.toLocaleString()} were already scouted by a team member and removed.` : ''} Rows with email were saved as Ready; no-email rows were saved as Pending for Auto Scout.${queuedResearch ? ` Queued ${queuedResearch.toLocaleString()} research job(s).` : ''}`);
    } catch (error) {
      const message = formatImportError(error);
      console.error('Scout v8.10 fast import failed:', error);
      setErrors([message]);
      setPhase('failed');
      setProgress('Import failed. See the real error below.');
    } finally {
      setImporting(false);
    }
  }

  async function fetchPendingNoEmailBusinesses(maxRows = 50000) {
    const all: Business[] = [];
    const pageSize = 1000;
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('workspace_id', workspace.id)
        .in('status', ['pending', 'scanning', 'found', 'review'])
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = ((data || []) as Business[]).filter((b) => !String(b.email || '').trim());
      all.push(...batch);
      if (!data || data.length < pageSize) break;
    }
    return all;
  }

  async function exportPendingNoEmailForScout() {
    setImporting(true);
    setErrors([]);
    try {
      const pending = await fetchPendingNoEmailBusinesses();
      if (!pending.length) {
        setProgress('No pending no-email businesses found to export for Auto Scout.');
        return;
      }
      downloadBusinessRows('scout-pending-no-email-for-auto-scout.csv', pending);
      setProgress(`Exported ${pending.length.toLocaleString()} pending no-email business(es) for Auto Scout.`);
    } catch (error) {
      setErrors([formatImportError(error)]);
    } finally {
      setImporting(false);
    }
  }

  async function deletePendingNoEmailBusinesses() {
    const ok = confirm('Delete all Pending/Scanning/Found/Review businesses that have no email? Export them first if you still need them for Auto Scout.');
    if (!ok) return;
    setImporting(true);
    setErrors([]);
    try {
      const { data, error } = await supabase.rpc('delete_pending_no_email_businesses', { target_workspace: workspace.id });
      if (error) throw error;
      setProgress(`Deleted ${(Number(data) || 0).toLocaleString()} pending no-email business(es).`);
    } catch (error) {
      setErrors([formatImportError(error)]);
    } finally {
      setImporting(false);
    }
  }

  async function repairEmailRouting() {
    setImporting(true);
    setErrors([]);
    try {
      const { data, error } = await supabase.rpc('mark_ready_emails_and_pending_no_email', { target_workspace: workspace.id });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      setProgress(`Repaired routing. Ready with email: ${Number(row?.ready_count || 0).toLocaleString()}. Pending without email: ${Number(row?.pending_count || 0).toLocaleString()}.`);
    } catch (error) {
      setErrors([formatImportError(error)]);
    } finally {
      setImporting(false);
    }
  }

  const detectedEmailCount = rows.filter((row) => row.email).length;
  const detectedWebsiteCount = rows.filter((row) => row.website || row.domain).length;

  return (
    <div className="stack">
      <div className="card" style={{ padding: 18 }}>
        <label className="label">Upload CSV</label>
        <input className="input" type="file" accept=".csv,text/csv" onChange={onFile} />
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label className="label">Audience category for this upload</label>
            <select className="select" value={audienceCategoryId} onChange={(event) => { setAudienceCategoryId(event.target.value); const cat = categories.find((c) => c.id === event.target.value); if (cat) setNewAudienceCategory(cat.name); }}>
              <option value="">New / uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">New category name</label>
            <input className="input" value={newAudienceCategory} onChange={(event) => { setNewAudienceCategory(event.target.value); if (audienceCategoryId) setAudienceCategoryId(''); }} placeholder="Airtable service, Marketing, Shopify audit" />
          </div>
        </div>
        <p className="muted">Limit: 100,000 usable rows. Import divides rows clearly: emails → Ready for Message; no email → Pending for Auto Scout; duplicates are skipped/exportable; invalid rows are downloadable. It scans email1/email2/email3/validatedEmail columns and every cell.</p>
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
          <button className="btn" disabled={!rows.length || importing || rows.length > MAX_IMPORT_ROWS} onClick={importRows}>{importing ? 'Importing...' : `Import ${rows.length.toLocaleString()} business(es)`}</button>
          <button className="btn secondary" type="button" disabled={importing} onClick={repairEmailRouting}>Repair: Email → Ready / No Email → Pending</button>
          <button className="btn secondary" type="button" disabled={importing} onClick={exportPendingNoEmailForScout}>Export Pending No-Email for Auto Scout</button>
          <button className="btn danger" type="button" disabled={importing} onClick={deletePendingNoEmailBusinesses}>Delete Pending No-Email</button>
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
          <div className="card kpi"><div className="title">Already In This Account</div><div className="num">{result.skippedScouted.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Team Already Scouted</div><div className="num">{Number((result as any).skippedTeam || 0).toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">File Duplicates</div><div className="num">{result.skippedFileDuplicates.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Invalid Rows</div><div className="num">{result.invalidRows.length.toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Research Jobs</div><div className="num">{(result.queuedResearch || 0).toLocaleString()}</div></div>
          <div className="card kpi"><div className="title">Batch ID</div><div className="num" style={{ fontSize: 12, wordBreak: 'break-all' }}>{result.batchId || '-'}</div></div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Preview</h3>
          <p className="muted">Showing first 25 rows only. Full file detected: {detectedEmailCount.toLocaleString()} email row(s), {detectedWebsiteCount.toLocaleString()} website/domain row(s). If the first 25 rows show blank email but this count is above 0, the emails are later in the file.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Website</th><th>Category</th><th>Location</th><th>Dedupe Key</th></tr></thead>
              <tbody>
                {rows.slice(0, 25).map((row, index) => (
                  <tr key={`${row.normalized_key}-${index}`}>
                    <td>{row.name || '-'}</td><td>{row.email || '-'}</td><td>{row.website || row.domain || '-'}</td><td>{row.category || '-'}</td><td>{row.location || '-'}</td><td>{row.normalized_key}</td>
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
