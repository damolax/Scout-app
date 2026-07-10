'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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

type ScoutStats = Record<string, number> & { pending_no_email?: number; found_with_email?: number; stale_running?: number };

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
  return String(result?.email || result?.bestEmail || result?.best_email || result?.validatedEmail || result?.result?.email || result?.data?.email || (Array.isArray(result?.emails) ? result.emails[0] : '') || '').trim();
}

function getEvidenceFromResult(result: any) {
  if (!result || typeof result !== 'object') return '';
  const direct = result.sourceUrl || result.source_url || result.foundOn || result.found_on || result.contactPage || result.contact_page || result.page || result.url || result.website;
  if (direct) return String(direct);
  const arrays = [result.sources, result.pages, result.urls, result.links, result.evidence];
  for (const item of arrays) {
    if (Array.isArray(item) && item.length) {
      const first = item.find(Boolean);
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') return String(first.url || first.href || first.page || first.source || '');
    }
  }
  return '';
}

function qualityLabel(result: any) {
  const evidence = getEvidenceFromResult(result);
  const generated = Boolean(result?.generated || result?.guessed || result?.pattern || String(result?.method || '').toLowerCase().includes('guess'));
  if (evidence) return 'source seen';
  if (generated) return 'generated only';
  return 'unverified candidate';
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
  const [message, setMessage] = useState('Ready. Queue pending/no-email businesses, then click Start Auto Scout. Use the found-email table below as the source of truth.');
  const [workerCycles, setWorkerCycles] = useState(8);
  const [workerResult, setWorkerResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const foundRows = useMemo(() => {
    const rows = [...results.map((row) => ({ session: true, row })), ...recentJobs.map((job) => ({ session: false, row: job }))];
    return rows
      .map((item) => {
        const row: any = item.row;
        const business = item.session ? null : getBusiness(row as JobRow);
        const result = item.session ? row : row.result;
        const email = String(row.email || business?.email || getEmailFromResult(result)).trim();
        const businessName = String(row.businessName || row.business || business?.name || '').trim();
        const evidence = String(row.evidence || getEvidenceFromResult(result)).trim();
        const quality = String(row.quality || qualityLabel(result));
        const status = String(row.status || '').trim();
        const reason = String(row.error || row.reason || row.last_error || '').trim();
        const pagesChecked = Number(row.pagesChecked || result?.deepWebsiteFinder?.pagesChecked || result?.pagesChecked || 0);
        const id = String(row.business || business?.id || row.id || '');
        return { id, email, businessName, evidence, quality, status, pagesChecked, reason };
      })
      .filter((row) => row.email || row.status === 'failed' || row.status === 'no_email_found' || row.reason)
      .slice(0, 120);
  }, [recentJobs, results]);

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

    const staleSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: staleRunning } = await supabase
      .from('email_research_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('status', 'running')
      .lt('updated_at', staleSince);
    next.stale_running = staleRunning || 0;
    setStats(next);

    const { data } = await supabase
      .from('email_research_jobs')
      .select('id,status,attempts,last_error,result,created_at,updated_at,started_at,finished_at,businesses(id,name,email,website,domain,category,location,status)')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false })
      .limit(80);
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
    const safeBatch = Math.max(1, Math.min(500, batchSize));
    const safeConcurrency = Math.max(1, Math.min(50, concurrency));
    const res = await fetch(`/api/research/run-once?limit=${safeBatch}&concurrency=${safeConcurrency}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Run request failed.');
    const newResults = Array.isArray(json.results) ? json.results : [];
    setResults((current) => [...newResults, ...current].slice(0, 300));
    return { processed: Number(json.processed || 0), found: newResults.filter((r: any) => r.status === 'found' || r.email).length };
  }

  async function startAutoScout() {
    stopRef.current = false;
    setRunning(false);
    setMessage('Starting durable server Auto Scout worker. You can leave this page; queued/running jobs remain in the database and Operations/Cron can continue them.');
    await runAutoScoutWorker();
  }

  async function runBatchManually() {
    setBusy(true);
    try {
      setMessage(`Running one backend batch of up to ${batchSize.toLocaleString()} queued job(s)...`);
      const batch = await runOneBatch();
      setMessage(`One batch complete. Processed ${batch.processed.toLocaleString()} job(s); found ${batch.found.toLocaleString()} email candidate(s).`);
      await loadStats();
    } catch (error) {
      setMessage(`Batch failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }


  async function quarantineFalsePositiveEmails() {
    setBusy(true);
    try {
      setMessage('Checking found/ready emails for captcha, asset, CDN, and code false positives...');
      const res = await fetch('/api/research/quarantine-false-positives', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: 5000 })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Quarantine request failed.');
      setMessage(`False-positive check complete. Checked ${Number(json.checked || 0).toLocaleString()} email(s); quarantined ${Number(json.quarantined || 0).toLocaleString()} bad email(s). Re-run Auto Scout for those businesses.`);
      await loadStats();
    } catch (error) {
      setMessage(`False-positive cleanup failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }


  async function quarantineRepeatedEmails() {
    setBusy(true);
    try {
      setMessage('Checking for the same email repeated across unrelated businesses...');
      const res = await fetch('/api/research/quarantine-repeated-emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: 50000 })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Repeated-email guard request failed.');
      setMessage(`Repeated-email guard complete. Checked ${Number(json.checkedGroups || 0).toLocaleString()} repeated email group(s); quarantined ${Number(json.quarantined || 0).toLocaleString()} suspicious business email(s). Those businesses are back in Review for re-scouting.`);
      await loadStats();
    } catch (error) {
      setMessage(`Repeated-email cleanup failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }



  async function runAutoScoutWorker() {
    setBusy(true);
    setWorkerResult(null);
    try {
      setMessage(`Running server Auto Scout worker for up to ${workerCycles} cycle(s). This can continue even if the browser is not looping batches.`);
      const res = await fetch('/api/research/run-worker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          autoEnqueue: true,
          enqueueLimit: queueLimit,
          cycles: workerCycles,
          batchSize,
          concurrency
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Auto Scout worker failed.');
      setWorkerResult(json);
      setMessage(`Worker complete. Queued ${Number(json.enqueued || 0).toLocaleString()}, processed ${Number(json.processed || 0).toLocaleString()}, found ${Number(json.found || 0).toLocaleString()}. ${json.stoppedReason || ''}`);
      await loadStats();
    } catch (error) {
      setMessage(`Worker failed: ${fmtError(error)}`);
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
        <div className="card kpi"><div className="title">Needs Research</div><div className="num">{(stats.pending_no_email || 0).toLocaleString()}</div><p className="muted">Pending/review businesses with no email.</p></div>
        <div className="card kpi"><div className="title">Waiting Jobs</div><div className="num">{(stats.queued || 0).toLocaleString()}</div><p className="muted">Queued for backend email research.</p></div>
        <div className="card kpi"><div className="title">Active Jobs</div><div className="num">{(stats.running || 0).toLocaleString()}</div><p className="muted">Currently marked running. Stale: {(stats.stale_running || 0).toLocaleString()}.</p></div>
        <div className="card kpi"><div className="title">Trusted Candidates Found</div><div className="num">{(stats.found_with_email || 0).toLocaleString()}</div><p className="muted">Passed strict rules. Still not inbox-proven until send/bounce tracking.</p></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Auto Scout Control</h3>
        <p className="muted">Auto Scout controls the durable database queue and calls your backend email-finder. v8.33 uses server workers, so jobs remain queued/running even if you leave this page and come back later. It rejects captcha/CDN/code false positives, blocks repeated emails across unrelated businesses, then searches deeper: homepage, contact/about/team/impressum/privacy pages, mailto links, obfuscated emails, and Cloudflare-protected emails where possible.</p>
        <div className="grid grid-4">
          <div><label className="label">Queue limit</label><input className="input" type="number" min={1} max={50000} value={queueLimit} onChange={(e) => setQueueLimit(Math.max(1, Math.min(50000, Number(e.target.value) || 5000)))} /><p className="muted">How many no-email businesses to add to the research queue.</p></div>
          <div><label className="label">Backend batch size</label><input className="input" type="number" min={1} max={500} value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(500, Number(e.target.value) || 100)))} /><p className="muted">Maximum queued jobs sent to one Node API run.</p></div>
          <div><label className="label">Backend concurrency</label><input className="input" type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(50, Number(e.target.value) || 20)))} /><p className="muted">How many backend lookups run in parallel inside that batch.</p></div>
          <div><label className="label">Worker cycles</label><input className="input" type="number" min={1} max={25} value={workerCycles} onChange={(e) => setWorkerCycles(Math.max(1, Math.min(25, Number(e.target.value) || 8)))} /><p className="muted">How many server batches the worker should run in one click.</p></div>
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" disabled={busy} onClick={enqueuePendingNoEmail}>Queue Pending No-Email</button>
          <button className="btn" disabled={busy} onClick={startAutoScout}>Start Durable Auto Scout</button>
          <button className="btn secondary" disabled={busy || running} onClick={runBatchManually}>Run One Backend Batch</button>
          <button className="btn" disabled={busy || running} onClick={runAutoScoutWorker}>Run Server Worker</button>
          <button className="btn secondary" disabled={busy && !running} onClick={loadStats}>Refresh Progress</button>
          <button className="btn secondary" disabled={busy || running} onClick={quarantineFalsePositiveEmails}>Clean Bad Found Emails</button>
          <button className="btn secondary" disabled={busy || running} onClick={quarantineRepeatedEmails}>Clean Repeated Emails</button>
        </div>
        <div className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'error' : 'notice'} style={{ marginTop: 12 }}>{message}</div>
        {workerResult ? <div className="notice" style={{ marginTop: 12 }}><strong>Worker summary:</strong> checked {Number(workerResult.checkedForQueue || 0).toLocaleString()}, queued {Number(workerResult.enqueued || 0).toLocaleString()}, cycles {Number(workerResult.cyclesRun || 0).toLocaleString()}, processed {Number(workerResult.processed || 0).toLocaleString()}, found {Number(workerResult.found || 0).toLocaleString()}.</div> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>What These Numbers Mean</h3>
        <p className="muted"><strong>Queue limit</strong> decides how many no-email businesses are placed into the queue. <strong>Backend batch size</strong> decides how many queued jobs one run tries to process. <strong>Backend concurrency</strong> decides how many of those lookups happen at the same time. <strong>Run Server Worker</strong> is the v8.28 worker: it queues no-email businesses, resets stale running jobs, then calls <code>/api/research/run-once</code> repeatedly on the server. Render is still used when <code>NEXT_PUBLIC_BACKEND_URL</code> points to your Render email-finder.</p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Found Emails / Errors</h3>
        <p className="muted">This table combines current-session results and recent database jobs. Only candidates that pass strict rules are promoted. Weak/generated candidates are kept in Review with a reason instead of being treated as found. Deep website results show source evidence and pages checked when available.</p>
        <div className="table-wrap"><table><thead><tr><th>Status</th><th>Email</th><th>Business</th><th>Quality</th><th>Evidence</th><th>Pages</th><th>Reason</th></tr></thead><tbody>
          {foundRows.map((row, index) => <tr key={`${row.id || row.email}-${index}`}><td>{row.status || '-'}</td><td>{row.email || <span className="muted">No email</span>}</td><td>{row.id ? <Link href={`/businesses/${row.id}`}>{row.businessName || row.id}</Link> : row.businessName || '-'}</td><td>{row.quality || '-'}</td><td>{row.evidence ? <a href={row.evidence.startsWith('http') ? row.evidence : `https://${row.evidence}`} target="_blank" rel="noreferrer">source</a> : <span className="muted">No evidence supplied</span>}</td><td>{String((row as any).pagesChecked || '')}</td><td>{row.reason || ''}</td></tr>)}
          {!foundRows.length ? <tr><td colSpan={7} className="muted">No found-email rows or errors yet. If the top counter says emails were found, click Refresh Progress and check Recent Auto Scout Jobs below.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Recent Auto Scout Jobs</h3>
        <div className="table-wrap"><table><thead><tr><th>Business</th><th>Status</th><th>Email</th><th>Quality</th><th>Attempts</th><th>Error</th></tr></thead><tbody>
          {recentJobs.map((job) => {
            const business = getBusiness(job);
            const email = String(business?.email || getEmailFromResult(job.result) || '');
            return <tr key={job.id}><td>{business?.id ? <Link href={`/businesses/${business.id}`}><strong>{business?.name || '-'}</strong></Link> : <strong>{business?.name || '-'}</strong>}<br /><span className="muted">{business?.website || business?.domain || ''}</span></td><td><span className={`status ${job.status}`}>{job.status}</span></td><td>{email || <span className="muted">No email yet</span>}</td><td>{qualityLabel(job.result)}</td><td>{job.attempts || 0}</td><td><span className="muted">{job.last_error || ''}</span></td></tr>;
          })}
          {!recentJobs.length ? <tr><td colSpan={6} className="muted">No Auto Scout jobs yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="notice">
        <strong>Trust rule:</strong> Auto Scout can find email candidates, but a real inbox is only confirmed after sending and bounce/no-inbox detection. v8.17 also blocks one exact email from being promoted across unrelated businesses unless it has business-domain/source evidence.
      </div>
    </div>
  );
}
