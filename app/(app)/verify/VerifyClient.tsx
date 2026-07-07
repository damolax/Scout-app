'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Business, BusinessStatus, Workspace } from '@/lib/types';

const PAGE_SIZE = 100;
const VERIFY_CHUNK_SIZE = 500;
const UPDATE_CONCURRENCY = 25;
const PROVIDERS = ['basic_mx', 'zerobounce', 'abstract', 'hunter', 'neverbounce', 'kickbox'];

type VerifyFilter = 'has_email' | 'needs_verification' | 'ready' | 'review' | 'invalid' | 'all';
type VerifyStats = Record<string, number> & { total?: number; has_email?: number };
type BackendVerifyResult = {
  email: string;
  status?: string;
  score?: number;
  readyToContact?: boolean;
  provider?: string;
  providerStatus?: string;
  providerReason?: string;
  validFormat?: boolean;
  hasMx?: boolean;
  isRoleBased?: boolean;
  isFreeProvider?: boolean;
  checkedAt?: string;
  [key: string]: unknown;
};

type VerifySummary = {
  checked: number;
  ready: number;
  review: number;
  invalid: number;
  errors: number;
};

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

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
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

function statusFromVerification(result?: BackendVerifyResult): BusinessStatus {
  if (!result) return 'review';
  const status = String(result.status || '').toLowerCase();
  const score = Number(result.score || 0);
  if (result.readyToContact || (status === 'valid' && score >= 70)) return 'ready';
  if (['invalid', 'undeliverable', 'bad_format'].includes(status) || result.validFormat === false || result.hasMx === false) return 'invalid';
  return 'review';
}

function reasonFromVerification(result?: BackendVerifyResult) {
  if (!result) return 'No verification result.';
  return [
    result.status ? `status=${result.status}` : '',
    typeof result.score !== 'undefined' ? `score=${result.score}` : '',
    result.provider ? `provider=${result.provider}` : '',
    result.providerStatus ? `provider_status=${result.providerStatus}` : '',
    result.providerReason ? `reason=${result.providerReason}` : '',
    result.isRoleBased ? 'role_email' : '',
    result.isFreeProvider ? 'free_provider' : ''
  ].filter(Boolean).join(' · ');
}

async function parallelLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export default function VerifyClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<VerifyFilter>('needs_verification');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('basic_mx');
  const [limit, setLimit] = useState(100);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<VerifyStats>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Load contacts with emails, then verify selected contacts or the current page.');
  const [error, setError] = useState('');
  const [lastResults, setLastResults] = useState<Array<Record<string, unknown>>>([]);
  const [backendNote, setBackendNote] = useState('');
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function applyFilter(query: any) {
    if (filter === 'has_email') query = query.not('email', 'is', null).neq('email', '');
    if (filter === 'needs_verification') query = query.not('email', 'is', null).neq('email', '').in('status', ['pending', 'found', 'review']);
    if (filter === 'ready') query = query.eq('status', 'ready');
    if (filter === 'review') query = query.eq('status', 'review');
    if (filter === 'invalid') query = query.in('status', ['invalid', 'no_inbox', 'bounced']);
    return query;
  }

  async function loadStats() {
    const next: VerifyStats = {};
    const { count: totalCount } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id);
    next.total = totalCount || 0;
    const { count: hasEmail } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).not('email', 'is', null).neq('email', '');
    next.has_email = hasEmail || 0;
    await Promise.all(['pending', 'found', 'ready', 'review', 'invalid', 'no_inbox', 'bounced'].map(async (status) => {
      const { count } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', status);
      next[status] = count || 0;
    }));
    setStats(next);
  }

  async function loadBusinesses(nextPage = page) {
    setLoading(true);
    setError('');
    try {
      const from = nextPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('businesses')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspace.id)
        .order('updated_at', { ascending: false })
        .range(from, to);
      query = applyFilter(query);
      const cleanSearch = search.trim().replace(/[%_]/g, '');
      if (cleanSearch) query = query.or(`name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`);
      const { data, count, error: loadError } = await query;
      if (loadError) throw loadError;
      setBusinesses((data || []) as Business[]);
      setTotal(count || 0);
      setPage(nextPage);
      setSelected({});
      setMessage(`Loaded ${(data || []).length.toLocaleString()} contact(s). Page size is ${PAGE_SIZE}; verification runs only on selected/current contacts to avoid freezing.`);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBusinesses(0);
    loadStats();
    checkVerifierConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function checkVerifierConfig() {
    try {
      const response = await fetch(`/api/backend/verifier-config?provider=${encodeURIComponent(provider)}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || json?.message || `Backend verifier config failed: ${response.status}`);
      setBackendNote(json?.note || `Verifier provider: ${json?.requestedProvider || provider}`);
    } catch (err) {
      setBackendNote(`Could not read backend verifier config: ${formatError(err)}`);
    }
  }

  useEffect(() => { checkVerifierConfig(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);

  async function refresh() {
    await Promise.all([loadBusinesses(page), loadStats()]);
  }

  async function fetchNextBatch() {
    let query = supabase
      .from('businesses')
      .select('*')
      .eq('workspace_id', workspace.id)
      .not('email', 'is', null)
      .neq('email', '')
      .in('status', ['pending', 'found', 'review'])
      .order('updated_at', { ascending: true })
      .limit(Math.max(1, Math.min(500, limit)));
    const cleanSearch = search.trim().replace(/[%_]/g, '');
    if (cleanSearch) query = query.or(`name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`);
    const { data, error: batchError } = await query;
    if (batchError) throw batchError;
    return (data || []) as Business[];
  }

  async function persistVerification(targets: Business[], results: BackendVerifyResult[]) {
    const byEmail = new Map(results.map((item) => [normalizeEmail(item.email), item]));
    const checkedAt = new Date().toISOString();
    const candidateRows: Array<Record<string, unknown>> = [];
    const rowsForDownload: Array<Record<string, unknown>> = [];
    const summary: VerifySummary = { checked: 0, ready: 0, review: 0, invalid: 0, errors: 0 };

    await parallelLimit(targets, UPDATE_CONCURRENCY, async (business) => {
      const result = byEmail.get(normalizeEmail(business.email));
      if (!result) {
        summary.errors += 1;
        rowsForDownload.push({ name: business.name, email: business.email, status: 'missing_result', reason: 'Backend did not return this email.' });
        return;
      }
      const nextStatus = statusFromVerification(result);
      const score = typeof result.score === 'number' ? result.score : business.score;
      const raw = { ...(business.raw || {}), verification: result, verification_checked_at: checkedAt };
      const { error: updateError } = await supabase
        .from('businesses')
        .update({ status: nextStatus, score, raw })
        .eq('workspace_id', workspace.id)
        .eq('id', business.id);
      if (updateError) throw updateError;
      candidateRows.push({
        workspace_id: workspace.id,
        business_id: business.id,
        email: normalizeEmail(business.email),
        source: 'backend_verifier',
        score,
        status: String(result.status || nextStatus),
        raw: result
      });
      summary.checked += 1;
      if (nextStatus === 'ready') summary.ready += 1;
      else if (nextStatus === 'invalid') summary.invalid += 1;
      else summary.review += 1;
      rowsForDownload.push({
        name: business.name,
        email: business.email,
        business_status: nextStatus,
        verification_status: result.status || '',
        score: score || '',
        provider: result.provider || '',
        reason: reasonFromVerification(result)
      });
    });

    for (let i = 0; i < candidateRows.length; i += 500) {
      const chunk = candidateRows.slice(i, i + 500);
      const { error: upsertError } = await supabase
        .from('email_candidates')
        .upsert(chunk, { onConflict: 'workspace_id,business_id,email' });
      if (upsertError) throw upsertError;
    }

    setLastResults(rowsForDownload);
    return summary;
  }

  async function verifyContacts(mode: 'selected' | 'page' | 'next') {
    setBusy(true);
    setError('');
    setProgress(0);
    setLastResults([]);
    try {
      let targets: Business[] = [];
      if (mode === 'selected') targets = businesses.filter((b) => selected[b.id] && b.email);
      if (mode === 'page') targets = businesses.filter((b) => b.email);
      if (mode === 'next') targets = await fetchNextBatch();
      const byEmail = new Map<string, Business>();
      for (const business of targets) {
        const email = normalizeEmail(business.email);
        if (email && !byEmail.has(email)) byEmail.set(email, business);
      }
      targets = Array.from(byEmail.values()).slice(0, Math.max(1, Math.min(500, limit)));
      if (!targets.length) {
        setMessage('No contacts with emails were found for this verification action.');
        return;
      }

      const started = performance.now();
      setMessage(`Verifying ${targets.length.toLocaleString()} email(s) with ${provider}...`);
      const allResults: BackendVerifyResult[] = [];
      for (let i = 0; i < targets.length; i += VERIFY_CHUNK_SIZE) {
        const chunk = targets.slice(i, i + VERIFY_CHUNK_SIZE);
        const response = await fetch('/api/backend/batch-verify-emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emails: chunk.map((b) => b.email), provider, delayMs: 0 })
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.success === false) throw new Error(json?.error || json?.message || `Backend verification failed with HTTP ${response.status}`);
        allResults.push(...((json?.results || []) as BackendVerifyResult[]));
        setProgress(Math.round(Math.min(95, ((i + chunk.length) / targets.length) * 70)));
      }

      setMessage('Saving verification results to Supabase...');
      const summary = await persistVerification(targets, allResults);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      setProgress(100);
      setSelected({});
      setMessage(`Verified ${summary.checked.toLocaleString()} contact(s) in ${seconds}s. Ready: ${summary.ready.toLocaleString()}, Review: ${summary.review.toLocaleString()}, Invalid: ${summary.invalid.toLocaleString()}, Errors: ${summary.errors.toLocaleString()}.`);
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
    setSelected(Object.fromEntries(businesses.filter((b) => b.email).map((b) => [b.id, true])));
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Has Email</div><div className="num">{(stats.has_email || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Ready</div><div className="num">{(stats.ready || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Review</div><div className="num">{(stats.review || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Invalid / No Inbox</div><div className="num">{((stats.invalid || 0) + (stats.no_inbox || 0) + (stats.bounced || 0)).toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div className="actions" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, email, website..." value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') loadBusinesses(0); }} />
            <select className="select" style={{ maxWidth: 210 }} value={filter} onChange={(event) => { setFilter(event.target.value as VerifyFilter); setPage(0); }}>
              <option value="needs_verification">Needs verification</option>
              <option value="has_email">All with email</option>
              <option value="ready">Ready</option>
              <option value="review">Review</option>
              <option value="invalid">Invalid / No Inbox</option>
              <option value="all">All businesses</option>
            </select>
            <select className="select" style={{ maxWidth: 180 }} value={provider} onChange={(event) => setProvider(event.target.value)}>
              {PROVIDERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input className="input" style={{ maxWidth: 120 }} type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(Number(event.target.value || 100))} />
            <button className="btn secondary" type="button" disabled={loading || busy} onClick={() => loadBusinesses(0)}>Search</button>
          </div>
          <button className="btn secondary" type="button" disabled={loading || busy} onClick={refresh}>Refresh</button>
        </div>
        <div className="notice" style={{ marginTop: 12 }}>{backendNote || 'Backend verifier config is loading...'}</div>
        {busy ? <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div> : null}
        <div className={error ? 'error' : 'success'} style={{ marginTop: 12 }}>{error || message}</div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ marginBottom: 12 }}>
          <span className="badge">Selected: {selectedIds.length.toLocaleString()}</span>
          <button className="btn" type="button" disabled={!selectedIds.length || busy} onClick={() => verifyContacts('selected')}>Verify Selected</button>
          <button className="btn secondary" type="button" disabled={!businesses.some((b) => b.email) || busy} onClick={() => verifyContacts('page')}>Verify Current Page</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => verifyContacts('next')}>Verify Next {Math.max(1, Math.min(500, limit)).toLocaleString()}</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'ready')}>Mark Ready</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'review')}>Mark Review</button>
          <button className="btn secondary" type="button" disabled={!selectedIds.length || busy} onClick={() => updateStatus(selectedIds, 'invalid')}>Mark Invalid</button>
          <button className="btn secondary" type="button" disabled={!lastResults.length} onClick={() => downloadCsv('scout-verification-results.csv', lastResults)}>Download Last Results</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={businesses.length > 0 && selectedIds.length === businesses.filter((b) => b.email).length} onChange={(event) => toggleAll(event.target.checked)} /></th>
                <th>Business</th><th>Email</th><th>Status</th><th>Score</th><th>Verification</th><th>Website</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => {
                const verification = (b.raw || {}) as Record<string, any>;
                const verificationData = verification.verification as BackendVerifyResult | undefined;
                return (
                  <tr key={b.id}>
                    <td><input type="checkbox" disabled={!b.email} checked={!!selected[b.id]} onChange={(event) => setSelected((current) => ({ ...current, [b.id]: event.target.checked }))} /></td>
                    <td><strong>{b.name || '-'}</strong><br /><span className="muted">{b.category || ''} {b.location ? `· ${b.location}` : ''}</span></td>
                    <td>{b.email || <span className="muted">No email</span>}</td>
                    <td><span className={`status ${b.status}`}>{b.status.replace('_', ' ')}</span></td>
                    <td>{b.score ?? '-'}</td>
                    <td>{verificationData ? <span className="muted">{reasonFromVerification(verificationData)}</span> : <span className="muted">Not checked</span>}</td>
                    <td>{b.website || b.domain || <span className="muted">No site</span>}</td>
                    <td>
                      <button className="btn secondary" type="button" disabled={!b.email || busy} onClick={() => { setSelected({ [b.id]: true }); setTimeout(() => verifyContacts('selected'), 0); }}>Verify</button>
                    </td>
                  </tr>
                );
              })}
              {!businesses.length ? <tr><td colSpan={8} className="muted">No contacts found for this filter.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="actions" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn secondary" type="button" disabled={page <= 0 || loading || busy} onClick={() => loadBusinesses(page - 1)}>Previous</button>
          <span className="muted">Page {page + 1} of {pages.toLocaleString()} · {total.toLocaleString()} matching</span>
          <button className="btn secondary" type="button" disabled={page + 1 >= pages || loading || busy} onClick={() => loadBusinesses(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
