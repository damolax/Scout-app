'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Business, BusinessStatus, Workspace } from '@/lib/types';

const PAGE_SIZE = 100;
const DETECT_RPC_BATCH = 2000;
const MAX_DETECT_PER_RUN = 50000;

type VerifyFilter = 'has_email' | 'needs_verification' | 'ready' | 'review' | 'invalid' | 'all';
type VerifyStats = {
  total: number;
  has_email: number;
  found: number;
  ready: number;
  review: number;
  invalid_no_inbox: number;
  needs_detection: number;
};
type PageCursor = { updated_at: string; id: string };
type BackendVerifyResult = {
  email?: string;
  status?: string;
  score?: number;
  readyToContact?: boolean;
  provider?: string;
  providerReason?: string;
  validFormat?: boolean;
  hasMx?: boolean;
  isRoleBased?: boolean;
  isFreeProvider?: boolean;
  checkedAt?: string;
  [key: string]: unknown;
};
type DetectionSummary = { checked: number; ready: number; review: number; invalid: number };

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const item = error as { message?: string; code?: string; details?: string; hint?: string; error?: string };
    return [item.message || item.error, item.code ? `Code: ${item.code}` : '', item.details ? `Details: ${item.details}` : '', item.hint ? `Hint: ${item.hint}` : ''].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

function alreadyDetected(business: Business) {
  if (business.email_verified_at) return true;
  if (business.email_verification_status && business.email_verification_status !== 'unchecked') return true;
  const raw = (business.raw || {}) as Record<string, any>;
  const checkedEmail = normalizeEmail(raw?.verification?.email || raw?.ready_email_detection?.email || '');
  return Boolean(raw?.verification || raw?.ready_email_detection || raw?.verification_checked_at) && (!checkedEmail || checkedEmail === normalizeEmail(business.email));
}

function reasonFromVerification(business: Business) {
  const raw = (business.raw || {}) as Record<string, any>;
  const result = raw.verification as BackendVerifyResult | undefined;
  if (result) {
    return [
      result.status ? `status=${result.status}` : '',
      typeof result.score !== 'undefined' ? `score=${result.score}` : '',
      result.provider ? `provider=${result.provider}` : '',
      result.providerReason ? `reason=${result.providerReason}` : '',
      result.isRoleBased ? 'role_email' : '',
      result.isFreeProvider ? 'free_provider' : ''
    ].filter(Boolean).join(' · ');
  }
  if (business.email_verified_at || business.email_verification_status) {
    return [
      business.email_verification_status ? `status=${business.email_verification_status}` : '',
      typeof business.score === 'number' ? `score=${business.score}` : '',
      business.email_verification_reason ? `reason=${business.email_verification_reason}` : '',
      business.email_role_label ? `role=${business.email_role_label}` : ''
    ].filter(Boolean).join(' · ');
  }
  return 'Not detected';
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Array.from(rows.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function asRow<T extends Record<string, unknown>>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] || null) as T | null;
  return (data || null) as T | null;
}

export default function VerifyClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<VerifyFilter>('needs_verification');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [limitText, setLimitText] = useState('5000');
  const [page, setPage] = useState(0);
  const [cursorStack, setCursorStack] = useState<Array<PageCursor | null>>([null]);
  const [hasNext, setHasNext] = useState(false);
  const [stats, setStats] = useState<VerifyStats>({ total: 0, has_email: 0, found: 0, ready: 0, review: 0, invalid_no_inbox: 0, needs_detection: 0 });
  const [statsWarning, setStatsWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Ready Email Detection uses indexed pages and set-based database updates. Already-detected emails are skipped.');
  const [error, setError] = useState('');
  const [lastResults, setLastResults] = useState<Array<Record<string, unknown>>>([]);
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function requestedLimit() {
    const raw = limitText.trim();
    if (!raw) return MAX_DETECT_PER_RUN;
    return Math.max(1, Math.min(MAX_DETECT_PER_RUN, Number(raw) || 5000));
  }

  function matchingEstimate() {
    if (appliedSearch) return null;
    if (filter === 'has_email') return stats.has_email;
    if (filter === 'needs_verification') return stats.needs_detection;
    if (filter === 'ready') return stats.ready;
    if (filter === 'review') return stats.review;
    if (filter === 'invalid') return stats.invalid_no_inbox;
    return stats.total;
  }

  async function loadStats() {
    const { data, error: statsError } = await supabase.rpc('ready_email_detection_stats_v10424', { target_workspace: workspace.id });
    if (statsError) {
      setStatsWarning(`Totals are temporarily unavailable: ${formatError(statsError)}`);
      return;
    }
    const row = asRow<Record<string, unknown>>(data);
    if (!row) return;
    setStats({
      total: Number(row.total_count || 0),
      has_email: Number(row.has_email_count || 0),
      found: Number(row.found_count || 0),
      ready: Number(row.ready_count || 0),
      review: Number(row.review_count || 0),
      invalid_no_inbox: Number(row.invalid_no_inbox_count || 0),
      needs_detection: Number(row.needs_detection_count || 0)
    });
    setStatsWarning('');
  }

  async function loadBusinesses(nextPage = 0, explicitCursor?: PageCursor | null, nextSearch = appliedSearch) {
    setLoading(true);
    setError('');
    try {
      const cursor = typeof explicitCursor === 'undefined' ? (cursorStack[nextPage] || null) : explicitCursor;
      const { data, error: loadError } = await supabase.rpc('ready_email_detection_page_v10424', {
        target_workspace: workspace.id,
        target_filter: filter,
        target_search: nextSearch || null,
        before_updated_at: cursor?.updated_at || null,
        before_id: cursor?.id || null,
        page_limit: PAGE_SIZE + 1
      });
      if (loadError) throw loadError;
      const rows = (data || []) as Business[];
      const nextAvailable = rows.length > PAGE_SIZE;
      const visible = rows.slice(0, PAGE_SIZE);
      setBusinesses(visible);
      setHasNext(nextAvailable);
      setPage(nextPage);
      setSelected({});
      const estimate = nextSearch ? null : matchingEstimate();
      setMessage(estimate === null
        ? `Showing ${visible.length.toLocaleString()} lightweight result(s) for this search. Exact full-table recounting is intentionally skipped.`
        : `Showing ${visible.length.toLocaleString()} contact(s). Approximately ${estimate.toLocaleString()} match this filter; totals refresh separately without blocking the page.`);
    } catch (err) {
      const text = formatError(err);
      setError(text.includes('PGRST202') ? `Ready Detection performance SQL is not installed. Run RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql. ${text}` : text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCursorStack([null]);
    setPage(0);
    void Promise.all([loadBusinesses(0, null, appliedSearch), loadStats()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function refresh() {
    await Promise.all([loadBusinesses(page, cursorStack[page] || null, appliedSearch), loadStats()]);
  }

  async function fetchLastResults(since: string, maxRows: number) {
    const { data } = await supabase
      .from('businesses')
      .select('name,email,status,score,email_verification_status,email_verification_reason,email_role_label,website,email_verified_at')
      .eq('workspace_id', workspace.id)
      .gte('email_verified_at', since)
      .order('email_verified_at', { ascending: false })
      .limit(Math.min(Math.max(maxRows, 1), 5000));
    setLastResults(((data || []) as Array<Record<string, unknown>>).map((row) => ({
      name: row.name,
      email: row.email,
      business_status: row.status,
      detection_status: row.email_verification_status,
      score: row.score,
      reason: row.email_verification_reason,
      role: row.email_role_label,
      website: row.website,
      checked_at: row.email_verified_at
    })));
  }

  async function runDetectionChunk(limit: number, ids: string[] | null) {
    const { data, error: runError } = await supabase.rpc('run_ready_email_detection_v10424', {
      target_workspace: workspace.id,
      target_limit: limit,
      target_search: ids ? null : (appliedSearch || null),
      target_ids: ids
    });
    if (runError) throw runError;
    const row = asRow<Record<string, unknown>>(data) || {};
    return {
      checked: Number(row.checked_count || 0),
      ready: Number(row.ready_count || 0),
      review: Number(row.review_count || 0),
      invalid: Number(row.invalid_count || 0)
    } satisfies DetectionSummary;
  }

  async function verifyContacts(mode: 'selected' | 'page' | 'next', explicitIds?: string[]) {
    setBusy(true);
    setError('');
    setProgress(0);
    setLastResults([]);
    const startedAt = new Date().toISOString();
    const summary: DetectionSummary = { checked: 0, ready: 0, review: 0, invalid: 0 };
    try {
      const requested = requestedLimit();
      if (mode === 'selected' || mode === 'page') {
        const source = mode === 'selected'
          ? businesses.filter((business) => (explicitIds ? explicitIds.includes(business.id) : selected[business.id]) && business.email && !alreadyDetected(business))
          : businesses.filter((business) => business.email && !alreadyDetected(business));
        const ids = Array.from(new Set(source.map((business) => business.id))).slice(0, requested);
        if (!ids.length) {
          setMessage('No undetected contacts with emails were found for this action.');
          return;
        }
        for (let index = 0; index < ids.length; index += DETECT_RPC_BATCH) {
          const chunk = ids.slice(index, index + DETECT_RPC_BATCH);
          const result = await runDetectionChunk(chunk.length, chunk);
          summary.checked += result.checked;
          summary.ready += result.ready;
          summary.review += result.review;
          summary.invalid += result.invalid;
          setProgress(Math.round(((index + chunk.length) / ids.length) * 100));
          setMessage(`Detecting and saving in one database operation: ${Math.min(index + chunk.length, ids.length).toLocaleString()} / ${ids.length.toLocaleString()}`);
        }
      } else {
        let remaining = requested;
        while (remaining > 0) {
          const batch = Math.min(DETECT_RPC_BATCH, remaining);
          const result = await runDetectionChunk(batch, null);
          summary.checked += result.checked;
          summary.ready += result.ready;
          summary.review += result.review;
          summary.invalid += result.invalid;
          remaining -= result.checked;
          setProgress(Math.round(Math.min(100, (summary.checked / requested) * 100)));
          setMessage(`Set-based detection: ${summary.checked.toLocaleString()} / ${requested.toLocaleString()} processed.`);
          if (result.checked < batch) break;
        }
      }
      setProgress(100);
      setSelected({});
      setMessage(`Detected ${summary.checked.toLocaleString()} email(s). Ready: ${summary.ready.toLocaleString()}, Review: ${summary.review.toLocaleString()}, Invalid: ${summary.invalid.toLocaleString()}.`);
      await fetchLastResults(startedAt, summary.checked);
      setCursorStack([null]);
      setPage(0);
      await Promise.all([loadBusinesses(0, null, appliedSearch), loadStats()]);
    } catch (err) {
      const text = formatError(err);
      setError(text.includes('PGRST202') ? `Ready Detection performance SQL is not installed. Run RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql. ${text}` : text);
    } finally {
      setBusy(false);
    }
  }

  async function queueForAutoScout(ids: string[], clearEmail = false) {
    if (!ids.length) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: queueError } = await supabase.rpc('queue_ready_email_redetection_v10424', {
        target_workspace: workspace.id,
        target_ids: ids,
        clear_email: clearEmail
      });
      if (queueError) throw queueError;
      setSelected({});
      setMessage(`${Number(data || ids.length).toLocaleString()} contact(s) queued for Auto Scout${clearEmail ? ' and their old email was removed' : ''}.`);
      await refresh();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedInvalid(ids: string[]) {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length.toLocaleString()} selected invalid/no-inbox lead(s)? This removes the lead record.`)) return;
    setBusy(true);
    setError('');
    try {
      const { error: deleteError } = await supabase.from('businesses').delete().eq('workspace_id', workspace.id).in('id', ids);
      if (deleteError) throw deleteError;
      setSelected({});
      setMessage(`Deleted ${ids.length.toLocaleString()} selected invalid/no-inbox lead(s).`);
      await refresh();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllInvalidEmails() {
    if (!window.confirm('Delete all invalid, bounced, blocked and no-inbox leads from this workspace?')) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: deleteError } = await supabase.rpc('delete_invalid_ready_detection_v10424', { target_workspace: workspace.id });
      if (deleteError) throw deleteError;
      setSelected({});
      setMessage(`Deleted ${Number(data || 0).toLocaleString()} invalid/no-inbox lead(s) with one set-based operation.`);
      await refresh();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(ids: string[], nextStatus: BusinessStatus) {
    if (!ids.length) return;
    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.from('businesses').update({ status: nextStatus }).eq('workspace_id', workspace.id).in('id', ids);
      if (updateError) throw updateError;
      setSelected({});
      setMessage(`Updated ${ids.length.toLocaleString()} contact(s) to ${nextStatus}.`);
      await refresh();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleAll(value: boolean) {
    if (!value) return setSelected({});
    setSelected(Object.fromEntries(businesses.filter((business) => business.email).map((business) => [business.id, true])));
  }

  function applySearch() {
    const clean = search.trim().replace(/[%_]/g, '');
    setAppliedSearch(clean);
    setCursorStack([null]);
    setPage(0);
    void loadBusinesses(0, null, clean);
  }

  function goNext() {
    const last = businesses[businesses.length - 1];
    if (!last || !hasNext) return;
    const cursor = { updated_at: last.updated_at, id: last.id };
    setCursorStack((current) => {
      const next = current.slice(0, page + 1);
      next[page + 1] = cursor;
      return next;
    });
    void loadBusinesses(page + 1, cursor, appliedSearch);
  }

  function goPrevious() {
    if (page <= 0) return;
    void loadBusinesses(page - 1, cursorStack[page - 1] || null, appliedSearch);
  }

  const nextLabel = limitText.trim() ? `Detect Next ${requestedLimit().toLocaleString()}` : 'Detect All Matching';
  const estimate = matchingEstimate();

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Has Email</div><div className="num">{stats.has_email.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Found</div><div className="num">{stats.found.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Ready</div><div className="num">{stats.ready.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Invalid / No Inbox</div><div className="num">{stats.invalid_no_inbox.toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div className="actions" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, email, website..." value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }} />
            <select className="select" style={{ maxWidth: 210 }} value={filter} onChange={(event) => { setFilter(event.target.value as VerifyFilter); setPage(0); }}>
              <option value="needs_verification">Needs detection</option>
              <option value="has_email">All with email</option>
              <option value="ready">Ready</option>
              <option value="review">Review</option>
              <option value="invalid">Invalid / No Inbox</option>
              <option value="all">All businesses</option>
            </select>
            <input className="input" style={{ maxWidth: 160 }} type="text" inputMode="numeric" placeholder="blank = all" value={limitText} onChange={(event) => setLimitText(event.target.value.replace(/[^0-9]/g, ''))} />
            <button className="btn secondary" type="button" disabled={loading || busy} onClick={applySearch}>Search</button>
          </div>
          <button className="btn secondary" type="button" disabled={loading || busy} onClick={refresh}>Refresh</button>
        </div>
        {busy ? <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div> : null}
        <div className={error ? 'error' : 'success'} style={{ marginTop: 12 }}>{error || message}</div>
        {statsWarning ? <div className="muted" style={{ marginTop: 8 }}>{statsWarning}</div> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ marginBottom: 12 }}>
          <span className="badge">Selected: {selectedIds.length.toLocaleString()}</span>
          <button className="btn" type="button" disabled={!selectedIds.length || busy} onClick={() => verifyContacts('selected')}>Detect Selected</button>
          <button className="btn secondary" type="button" disabled={!businesses.some((business) => business.email) || busy} onClick={() => verifyContacts('page')}>Detect Current Page</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => verifyContacts('next')}>{nextLabel}</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'ready')}>Mark Ready</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'review')}>Mark Review</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'invalid')}>Mark Invalid</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => queueForAutoScout(selectedIds, false)}>Redetect via Auto Scout</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => queueForAutoScout(selectedIds, true)}>Remove Email + Redetect</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => deleteSelectedInvalid(selectedIds)}>Delete Selected</button>
          <button className="btn danger" type="button" disabled={busy} onClick={deleteAllInvalidEmails}>Delete All Invalid</button>
          <button className="btn secondary" type="button" disabled={!lastResults.length} onClick={() => downloadCsv('scout-ready-email-detection-results.csv', lastResults)}>Download Last Results</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th><input type="checkbox" checked={businesses.length > 0 && selectedIds.length === businesses.filter((business) => business.email).length} onChange={(event) => toggleAll(event.target.checked)} /></th><th>Business</th><th>Email</th><th>Status</th><th>Score</th><th>Detection</th><th>Website</th><th>Actions</th></tr></thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.id}>
                  <td><input type="checkbox" disabled={!business.email} checked={!!selected[business.id]} onChange={(event) => setSelected((current) => ({ ...current, [business.id]: event.target.checked }))} /></td>
                  <td><strong>{business.name || '-'}</strong><br /><span className="muted">{business.category || ''} {business.location ? `· ${business.location}` : ''}</span></td>
                  <td>{business.email || <span className="muted">No email · send to Auto Scout</span>}</td>
                  <td><span className={`status ${business.status}`}>{business.status.replace('_', ' ')}</span></td>
                  <td>{business.score ?? '-'}</td>
                  <td><span className="muted">{reasonFromVerification(business)}</span></td>
                  <td>{business.website || business.domain || <span className="muted">No site</span>}</td>
                  <td><div className="actions compact"><button className="btn secondary" type="button" disabled={!business.email || alreadyDetected(business) || busy} onClick={() => void verifyContacts('selected', [business.id])}>{alreadyDetected(business) ? 'Checked' : 'Detect'}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => queueForAutoScout([business.id], false)}>Redetect</button></div></td>
                </tr>
              ))}
              {!businesses.length ? <tr><td colSpan={8} className="muted">No contacts found for this filter.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="actions" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn secondary" type="button" disabled={page <= 0 || loading || busy} onClick={goPrevious}>Previous</button>
          <span className="muted">Page {page + 1} · {businesses.length.toLocaleString()} shown{estimate !== null && !appliedSearch ? ` · about ${estimate.toLocaleString()} matching` : hasNext ? ' · more results available' : ''}</span>
          <button className="btn secondary" type="button" disabled={!hasNext || loading || busy} onClick={goNext}>Next</button>
        </div>
      </div>
    </div>
  );
}
