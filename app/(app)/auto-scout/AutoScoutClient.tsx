'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { emitLiveActivity } from '@/lib/live-activity-client';
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

function hostname(value: string) {
  try {
    const url = value.startsWith('http') ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

function emailDomain(email: string) {
  return String(email || '').split('@')[1]?.toLowerCase().replace(/^www\./, '') || '';
}

function looksBrokenEmail(email: string) {
  const e = String(email || '').toLowerCase().trim();
  if (!e || !/^[-a-z0-9._%+]+@[-a-z0-9.]+\.[a-z]{2,}$/i.test(e)) return true;
  if (['abc@xyz.com', 'test@test.com', 'email@example.com', 'ton-courriel@exemple.com'].includes(e)) return true;
  if (e.includes('chimpst@ic.com') || e.includes('maps.gst@ic.com') || e.includes('instagram.pin@')) return true;
  if (e.startsWith('www.') || e.includes('@example.') || e.includes('@exemple.')) return true;
  if (e.includes('@ic.com') && !e.includes('music')) return true;
  if (/apps?\d*\./.test(e.split('@')[0] || '')) return true;
  return false;
}

function trustForEmail(email: string, business: any, result: any, rowEvidence = '') {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) return { label: 'No email', tone: 'none', reason: 'No usable email found.' };
  if (looksBrokenEmail(cleanEmail)) return { label: 'Blocked', tone: 'blocked', reason: 'Looks like fake, example, code, or broken website text.' };
  const domain = emailDomain(cleanEmail);
  const site = hostname(String(business?.website || business?.domain || business?.url || ''));
  const evidence = rowEvidence || getEvidenceFromResult(result);
  if (site && domain && (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(site))) return { label: 'Trusted', tone: 'trusted', reason: 'Email matches the business website domain.' };
  if (evidence) return { label: 'Trusted', tone: 'trusted', reason: 'Email was seen on a business website page.' };
  return { label: 'Review', tone: 'review', reason: 'Looks possible, but Scout did not see enough proof yet.' };
}

function qualityLabel(result: any, business?: any, emailValue?: string) {
  return trustForEmail(emailValue || getEmailFromResult(result), business, result).label;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const [message, setMessage] = useState('Ready. Click Start Auto Scout to find missing emails.');
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
        const trust = trustForEmail(email, business, result, evidence);
        const quality = trust.label;
        const status = String(row.status || '').trim();
        const reason = String(row.error || row.reason || row.last_error || trust.reason || '').trim();
        const pagesChecked = Number(row.pagesChecked || result?.deepWebsiteFinder?.pagesChecked || result?.pagesChecked || 0);
        const id = String(row.business || business?.id || row.id || '');
        return { id, email, businessName, evidence, quality, trustTone: trust.tone, status, pagesChecked, reason };
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
    emitLiveActivity({ kind: 'auto_scout', status: 'queueing', title: 'Auto Scout queueing', message: `Queueing up to ${queueLimit.toLocaleString()} businesses for email research.` });
    try {
      const res = await fetch('/api/research/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: queueLimit, noEmailOnly: true })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Queue request failed.');
      setMessage(`Queued ${Number(json.enqueued || 0).toLocaleString()} job(s). Checked ${Number(json.checked || 0).toLocaleString()} pending/no-email business(es).`);
      emitLiveActivity({ kind: 'auto_scout', status: 'queued', title: 'Auto Scout queued', message: `Queued ${Number(json.enqueued || 0).toLocaleString()} job(s).` });
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
    emitLiveActivity({ kind: 'auto_scout', status: 'checking', title: 'Auto Scout checking', message: `Checking up to ${safeBatch.toLocaleString()} queued website(s) for emails.` });
    const res = await fetch(`/api/research/run-once?limit=${safeBatch}&concurrency=${safeConcurrency}&workspaceId=${encodeURIComponent(workspace.id)}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Run request failed.');
    const newResults = Array.isArray(json.results) ? json.results : [];
    setResults((current) => [...newResults, ...current].slice(0, 300));
    const found = newResults.filter((r: any) => r.status === 'found' || r.email).length;
    for (const item of newResults.slice(0, 8)) {
      emitLiveActivity({
        kind: 'auto_scout',
        status: item.email ? 'found' : String(item.status || 'checked'),
        title: item.email ? 'Email found' : 'Website checked',
        message: item.email ? `${item.businessName || 'Business'} → ${item.email}` : `${item.businessName || 'Business'}: ${item.status || 'checked'}`,
        businessName: item.businessName || '',
        website: item.evidence || '',
        countText: item.pagesChecked ? `${item.pagesChecked} page(s)` : undefined
      });
    }
    emitLiveActivity({ kind: 'auto_scout', status: 'batch_complete', title: 'Auto Scout batch complete', message: `Processed ${Number(json.processed || 0).toLocaleString()} job(s); found ${found.toLocaleString()} email(s).` });
    return { processed: Number(json.processed || 0), found };
  }

  async function startAutoScout() {
    stopRef.current = false;
    setBusy(true);
    setRunning(true);
    setWorkerResult(null);
    let totalQueued = 0;
    let totalProcessed = 0;
    let totalFound = 0;
    let emptyRounds = 0;

    try {
      setMessage('Finding emails now. Results will appear below on this same page.');
      emitLiveActivity({ kind: 'auto_scout', status: 'starting', title: 'Auto Scout starting', message: 'Queueing no-email leads and starting live website/email checks.' });

      const queueRes = await fetch('/api/research/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: queueLimit, noEmailOnly: true })
      });
      const queueJson = await queueRes.json().catch(() => ({}));
      if (!queueRes.ok || !queueJson.success) throw new Error(queueJson.error || 'Queue request failed.');
      totalQueued = Number(queueJson.enqueued || 0);
      setMessage(`Auto Scout queued ${totalQueued.toLocaleString()} new job(s). Starting live checks now...`);
      emitLiveActivity({ kind: 'auto_scout', status: 'queued', title: 'Auto Scout queued', message: `Queued ${totalQueued.toLocaleString()} new job(s).` });

      const maxCycles = Math.max(1, Math.min(50, workerCycles));
      for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
        if (stopRef.current) break;
        setMessage(`Auto Scout running live batch ${cycle.toLocaleString()} of ${maxCycles.toLocaleString()}...`);
        emitLiveActivity({ kind: 'auto_scout', status: 'checking', title: 'Auto Scout running', message: `Running live batch ${cycle.toLocaleString()} of ${maxCycles.toLocaleString()}.` });

        const batch = await runOneBatch();
        totalProcessed += batch.processed;
        totalFound += batch.found;
        await loadStats();

        if (!batch.processed) {
          emptyRounds += 1;
          if (emptyRounds >= 2) break;
        } else {
          emptyRounds = 0;
        }
        await sleep(600);
      }

      const stopped = stopRef.current;
      setMessage(stopped
        ? `Auto Scout stopped. Queued ${totalQueued.toLocaleString()}, processed ${totalProcessed.toLocaleString()}, found ${totalFound.toLocaleString()}.`
        : `Auto Scout complete for this run. Queued ${totalQueued.toLocaleString()}, processed ${totalProcessed.toLocaleString()}, found ${totalFound.toLocaleString()}.`);
      emitLiveActivity({ kind: 'auto_scout', status: stopped ? 'stopped' : 'complete', title: stopped ? 'Auto Scout stopped' : 'Auto Scout complete', message: `Processed ${totalProcessed.toLocaleString()} job(s); found ${totalFound.toLocaleString()} email(s).` });
    } catch (error) {
      setMessage(`Auto Scout failed: ${fmtError(error)}`);
      emitLiveActivity({ kind: 'auto_scout', status: 'failed', title: 'Auto Scout failed', message: fmtError(error) });
    } finally {
      setBusy(false);
      setRunning(false);
      await loadStats();
    }
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
      setMessage(`Running extra Auto Scout batches for up to ${workerCycles} cycle(s). Keep this page open while it works.`);
      emitLiveActivity({ kind: 'auto_scout', status: 'worker_running', title: 'Auto Scout running', message: `Running up to ${workerCycles} live cycle(s).` });
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
      if (!res.ok || !json.success) throw new Error(json.error || 'Auto Scout run failed.');
      setWorkerResult(json);
      setMessage(`Extra run complete. Queued ${Number(json.enqueued || 0).toLocaleString()}, processed ${Number(json.processed || 0).toLocaleString()}, found ${Number(json.found || 0).toLocaleString()}. ${json.stoppedReason || ''}`);
      emitLiveActivity({ kind: 'auto_scout', status: 'worker_complete', title: 'Auto Scout complete', message: `Queued ${Number(json.enqueued || 0).toLocaleString()}, processed ${Number(json.processed || 0).toLocaleString()}, found ${Number(json.found || 0).toLocaleString()}.` });
      await loadStats();
    } catch (error) {
      setMessage(`Auto Scout run failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function stopAutoScout() {
    stopRef.current = true;
    setMessage('Stopping Auto Scout after the current batch finishes...');
  }

  async function deleteInvalidEmailValues() {
    if (!window.confirm('Remove clearly bad/fake email values and send those leads back to Auto Scout?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/research/delete-invalid-emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: 5000 })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete bad emails failed.');
      setMessage(`Removed ${Number(json.updated || 0).toLocaleString()} bad email value(s). Those leads can now be redetected.`);
      await loadStats();
    } catch (error) {
      setMessage(`Bad-email cleanup failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Need emails</div><div className="num">{(stats.pending_no_email || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Waiting</div><div className="num">{(stats.queued || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Checking now</div><div className="num">{(stats.running || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Emails found</div><div className="num">{(stats.found_with_email || 0).toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Find missing emails</h3>
            <p className="muted" style={{ margin: '6px 0 0' }}>Click Start. Stop appears only while Scout is working. Results appear below and trusted emails are saved to your leads.</p>
          </div>
          <div className="actions">
            {running ? <button className="btn secondary" disabled={!running} onClick={stopAutoScout}>Stop</button> : null}
            <button className="btn" disabled={busy} onClick={startAutoScout}>Start finding emails</button>
          </div>
        </div>

        <div className="choice-row" style={{ marginTop: 14 }}>
          <label className="label" style={{ margin: 0 }}>How many to queue</label>
          <input className="input" style={{ width: 150 }} type="number" min={1} max={50000} value={queueLimit} onChange={(e) => setQueueLimit(Math.max(1, Math.min(50000, Number(e.target.value) || 5000)))} />
          <label className="label" style={{ margin: 0 }}>Check per batch</label>
          <input className="input" style={{ width: 120 }} type="number" min={1} max={500} value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(500, Number(e.target.value) || 100)))} />
          <label className="label" style={{ margin: 0 }}>Speed</label>
          <input className="input" style={{ width: 95 }} type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(50, Number(e.target.value) || 20)))} />
          <label className="label" style={{ margin: 0 }}>Rounds</label>
          <input className="input" style={{ width: 95 }} type="number" min={1} max={25} value={workerCycles} onChange={(e) => setWorkerCycles(Math.max(1, Math.min(25, Number(e.target.value) || 8)))} />
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" disabled={busy} onClick={enqueuePendingNoEmail}>Prepare missing-email leads</button>
          <button className="btn secondary" disabled={busy || running} onClick={runBatchManually}>Check one group</button>
          <button className="btn secondary" disabled={busy || running} onClick={loadStats}>Refresh</button>
          <button className="btn secondary" disabled={busy || running} onClick={quarantineFalsePositiveEmails}>Move bad emails to review</button>
          <button className="btn danger" disabled={busy || running} onClick={deleteInvalidEmailValues}>Delete invalid emails</button>
        </div>
        <div className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'error' : 'notice'} style={{ marginTop: 12 }}>{message}</div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 id="results">Results</h3>
        <p className="simple-table-note">Trusted emails are saved for sending. Review means it looks possible but needs checking. Blocked means Scout ignored it.</p>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Result</th><th>Email</th><th>Business</th><th>Proof</th><th>Why</th></tr></thead><tbody>
          {foundRows.map((row, index) => <tr key={`${row.id || row.email}-${index}`}>
            <td><span className={`trust-pill ${(row as any).trustTone || 'none'}`}>{row.quality || 'Review'}</span></td>
            <td>{row.email || <span className="muted">No email</span>}</td>
            <td>{row.id ? <Link href={`/businesses/${row.id}`}>{row.businessName || row.id}</Link> : row.businessName || '-'}</td>
            <td>{row.evidence ? <a href={row.evidence.startsWith('http') ? row.evidence : `https://${row.evidence}`} target="_blank" rel="noreferrer">source</a> : <span className="muted">-</span>}</td>
            <td><span className="muted">{row.reason || '-'}</span></td>
          </tr>)}
          {!foundRows.length ? <tr><td colSpan={5} className="muted">No results yet. Click Start Auto Scout.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Recent website checks</h3>
          <button className="btn secondary mini" type="button" onClick={loadStats}>Refresh</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Business</th><th>State</th><th>Email</th><th>Trust</th><th>Attempts</th></tr></thead><tbody>
          {recentJobs.map((job) => {
            const business = getBusiness(job);
            const email = String(business?.email || getEmailFromResult(job.result) || '');
            const trust = trustForEmail(email, business, job.result);
            return <tr key={job.id}><td>{business?.id ? <Link href={`/businesses/${business.id}`}><strong>{business?.name || '-'}</strong></Link> : <strong>{business?.name || '-'}</strong>}<br /><span className="muted">{business?.website || business?.domain || ''}</span></td><td><span className={`status ${job.status}`}>{job.status}</span></td><td>{email || <span className="muted">No email yet</span>}</td><td><span className={`trust-pill ${trust.tone}`}>{trust.label}</span></td><td>{job.attempts || 0}</td></tr>;
          })}
          {!recentJobs.length ? <tr><td colSpan={5} className="muted">No Auto Scout jobs yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
