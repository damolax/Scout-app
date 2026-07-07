'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { Workspace } from '@/lib/types';

type JobRow = {
  id: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  result?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  businesses?: any;
};

type ScoutStats = Record<string, number> & { pending_no_email?: number; found_with_email?: number };

function fmtError(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function getBusiness(job: JobRow) {
  return Array.isArray(job.businesses) ? job.businesses[0] : job.businesses;
}

function getEmailFromResult(result: any) {
  return String(result?.email || result?.bestEmail || result?.best_email || result?.result?.email || result?.data?.email || '').trim();
}

export default function AutoScoutClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const stopRef = useRef(false);
  const [queueLimit, setQueueLimit] = useState(5000);
  const [batchSize, setBatchSize] = useState(100);
  const [concurrency, setConcurrency] = useState(20);
  const [stats, setStats] = useState<ScoutStats>({});
  const [recentJobs, setRecentJobs] = useState<JobRow[]>([]);
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState('Ready. Queue pending/no-email businesses, then click Start Auto Scout. The tab shows live queued/running/found/failed progress.');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  async function loadStats() {
    const next: ScoutStats = {};
    await Promise.all(['queued', 'running', 'done', 'failed', 'cancelled'].map(async (status) => {
      const { count } = await supabase.from('email_research_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', status);
      next[status] = count || 0;
    }));
    const { count: pendingNoEmail } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .in('status', ['pending', 'review', 'found'])
      .or('email.is.null,email.eq.');
    next.pending_no_email = pendingNoEmail || 0;
    const { count: foundWithEmail } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('status', 'found')
      .not('email', 'is', null)
      .neq('email', '');
    next.found_with_email = foundWithEmail || 0;
    setStats(next);

    const { data } = await supabase
      .from('email_research_jobs')
      .select('id,status,attempts,last_error,result,created_at,updated_at,started_at,finished_at,businesses(id,name,email,website,domain,category,location,status)')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    setRecentJobs((data || []) as JobRow[]);
  }

  useEffect(() => {
    loadStats();
    const timer = window.setInterval(loadStats, running ? 2500 : 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, running]);

  async function enqueuePendingNoEmail() {
    setBusy(true);
    setMessage(`Queuing up to ${queueLimit.toLocaleString()} pending/no-email businesses for Auto Scout...`);
    try {
      const res = await fetch('/api/research/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: queueLimit, noEmailOnly: true })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Queue request failed.');
      setMessage(`Queued ${Number(json.enqueued || 0).toLocaleString()} job(s). Checked ${Number(json.checked || 0).toLocaleString()} pending/no-email business(es).`);
      await loadStats();
    } catch (error) {
      setMessage(`Queue failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runOneBatch() {
    const res = await fetch(`/api/research/run-once?limit=${Math.max(1, Math.min(500, batchSize))}&concurrency=${Math.max(1, Math.min(50, concurrency))}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Run request failed.');
    const newResults = Array.isArray(json.results) ? json.results : [];
    setResults((current) => [...newResults, ...current].slice(0, 300));
    return { processed: Number(json.processed || 0), found: newResults.filter((r: any) => r.status === 'found' || r.email).length };
  }

  async function startAutoScout() {
    stopRef.current = false;
    setRunning(true);
    setBusy(true);
    setResults([]);
    let totalProcessed = 0;
    let totalFound = 0;
    try {
      setMessage('Starting Auto Scout. Queuing pending/no-email businesses first...');
      await enqueuePendingNoEmail();
      setBusy(true);
      setMessage('Auto Scout is running. It will keep processing queued businesses until you stop it or the queue is empty.');
      while (!stopRef.current) {
        const batch = await runOneBatch();
        totalProcessed += batch.processed;
        totalFound += batch.found;
        await loadStats();
        setMessage(`Auto Scout running · processed ${totalProcessed.toLocaleString()} job(s), found ${totalFound.toLocaleString()} email(s). Click Stop Auto Scout to pause.`);
        if (!batch.processed) {
          setMessage(`Auto Scout stopped because there are no queued jobs left. Processed ${totalProcessed.toLocaleString()} job(s), found ${totalFound.toLocaleString()} email(s). Found emails should be checked in Ready Email Detection next.`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stopRef.current) setMessage(`Auto Scout paused by you. Processed ${totalProcessed.toLocaleString()} job(s), found ${totalFound.toLocaleString()} email(s).`);
    } catch (error) {
      setMessage(`Auto Scout stopped with error: ${fmtError(error)}`);
    } finally {
      setRunning(false);
      setBusy(false);
      stopRef.current = false;
      await loadStats();
    }
  }

  async function runBatchManually() {
    setBusy(true);
    try {
      setMessage(`Running one Auto Scout batch of up to ${batchSize.toLocaleString()} business(es)...`);
      const batch = await runOneBatch();
      setMessage(`One batch complete. Processed ${batch.processed.toLocaleString()} job(s); found ${batch.found.toLocaleString()} email(s).`);
      await loadStats();
    } catch (error) {
      setMessage(`Batch failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function stopAutoScout() {
    stopRef.current = true;
    setMessage('Stopping Auto Scout after the current backend batch finishes...');
  }

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Pending No Email</div><div className="num">{(stats.pending_no_email || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Queued</div><div className="num">{(stats.queued || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Running</div><div className="num">{(stats.running || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Found Emails</div><div className="num">{(stats.found_with_email || 0).toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Auto Scout Control</h3>
        <p className="muted">Auto Scout takes pending businesses without emails, queues them, then keeps asking the backend to find emails until you stop it or the queue finishes. Found emails go to <strong>found</strong>; run Ready Email Detection next to move valid ones to Ready.</p>
        <div className="grid grid-4">
          <div><label className="label">Queue pending/no-email</label><input className="input" type="number" min={1} max={50000} value={queueLimit} onChange={(e) => setQueueLimit(Math.max(1, Math.min(50000, Number(e.target.value) || 5000)))} /></div>
          <div><label className="label">Backend batch size</label><input className="input" type="number" min={1} max={500} value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(500, Number(e.target.value) || 100)))} /></div>
          <div><label className="label">Backend concurrency</label><input className="input" type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(50, Number(e.target.value) || 20)))} /></div>
          <div><label className="label">Mode</label><div className="badge">{running ? 'Running live' : 'Stopped'}</div></div>
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" disabled={busy} onClick={enqueuePendingNoEmail}>Queue Pending No-Email</button>
          {!running ? <button className="btn" disabled={busy} onClick={startAutoScout}>Start Auto Scout</button> : <button className="btn danger" onClick={stopAutoScout}>Stop Auto Scout</button>}
          <button className="btn secondary" disabled={busy || running} onClick={runBatchManually}>Run One Batch</button>
          <button className="btn secondary" disabled={busy && !running} onClick={loadStats}>Refresh Progress</button>
        </div>
        <div className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'error' : 'notice'} style={{ marginTop: 12 }}>{message}</div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Speed Note</h3>
        <p className="muted">The app can queue and control 5,000 businesses quickly, but actually finding emails depends on your backend, target websites/directories, rate limits, and Render/Vercel timeout limits. This page now runs batches continuously and shows live results; the dedicated backend worker will be the correct way to run thousands unattended later.</p>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Live Results From This Session</h3>
          <div className="table-wrap"><table><thead><tr><th>Status</th><th>Email</th><th>Business</th><th>Reason</th></tr></thead><tbody>
            {results.map((row, index) => <tr key={index}><td>{String(row.status || '-')}</td><td>{String(row.email || '')}</td><td>{String(row.business || row.businessName || row.id || '-')}</td><td>{String(row.error || row.reason || '')}</td></tr>)}
            {!results.length ? <tr><td colSpan={4} className="muted">Start Auto Scout to see found emails and errors as they happen.</td></tr> : null}
          </tbody></table></div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Recent Auto Scout Jobs</h3>
          <div className="table-wrap"><table><thead><tr><th>Business</th><th>Status</th><th>Email</th><th>Attempts</th><th>Error</th></tr></thead><tbody>
            {recentJobs.map((job) => {
              const business = getBusiness(job);
              const email = String(business?.email || getEmailFromResult(job.result) || '');
              return <tr key={job.id}><td><strong>{business?.name || '-'}</strong><br /><span className="muted">{business?.website || business?.domain || ''}</span></td><td><span className={`status ${job.status}`}>{job.status}</span></td><td>{email || <span className="muted">No email yet</span>}</td><td>{job.attempts || 0}</td><td><span className="muted">{job.last_error || ''}</span></td></tr>;
            })}
            {!recentJobs.length ? <tr><td colSpan={5} className="muted">No Auto Scout jobs yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}
