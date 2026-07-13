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

type ScoutStats = Record<string, number> & {
  total_missing?: number;
  need_emails?: number;
  found_with_email?: number;
  stale_running?: number;
};

const AUTO_SCOUT_QUEUE_MAX = 10000;
const AUTO_SCOUT_BATCH_SIZE = 20;
const AUTO_SCOUT_SPEED = 4;
const AUTO_SCOUT_ROUNDS_PER_CLICK = 12;

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
  const direct = result.sourceUrl || result.source_url || result.foundOn || result.found_on || result.contactPage || result.contact_page || result.page || result.url;
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function AutoScoutClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const stopRef = useRef(false);
  const [queueLimit, setQueueLimit] = useState(500);
  const [stats, setStats] = useState<ScoutStats>({});
  const [recentJobs, setRecentJobs] = useState<JobRow[]>([]);
  const [message, setMessage] = useState('Ready. Add leads to the queue, then start finding emails.');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [workerResult, setWorkerResult] = useState<any>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
  const backendLabel = backendUrl.includes('onrender.com') ? 'Render email finder connected' : backendUrl ? 'Email finder backend connected' : 'Email finder backend not configured';
  const queueCount = stats.queued || 0;
  const runningCount = stats.running || 0;
  const needsCount = stats.need_emails || 0;

  const foundRows = useMemo(() => {
    return recentJobs
      .map((job) => {
        const business = getBusiness(job);
        const result = job.result;
        const email = String(business?.email || getEmailFromResult(result)).trim();
        const businessName = String(business?.name || '').trim();
        const evidence = String(getEvidenceFromResult(result)).trim();
        const trust = trustForEmail(email, business, result, evidence);
        const reason = String(job.last_error || trust.reason || '').trim();
        const id = String(business?.id || job.id || '');
        return { id, email, businessName, website: business?.website || business?.domain || '', evidence, quality: trust.label, trustTone: trust.tone, status: job.status, attempts: job.attempts || 0, reason };
      })
      .filter((row) => row.email || row.status === 'failed' || row.status === 'done' || row.reason)
      .slice(0, 40);
  }, [recentJobs]);

  async function getQueuedCount() {
    const { count } = await supabase
      .from('email_research_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('status', 'queued');
    return count || 0;
  }

  async function loadStats() {
    try {
      const next: ScoutStats = {};
      await Promise.all(['queued', 'running', 'done', 'failed', 'cancelled'].map(async (status) => {
        const { count } = await supabase.from('email_research_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', status);
        next[status] = count || 0;
      }));

      const { count: totalMissing } = await supabase
        .from('businesses')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .or('email.is.null,email.eq.')
        .not('status', 'in', '(contacted,responded,bad_inbox,bounced,no_inbox,blocked,invalid,duplicate,archived,unsubscribed,do_not_contact,sent)');
      next.total_missing = totalMissing || 0;
      next.need_emails = Math.max((totalMissing || 0) - (next.queued || 0) - (next.running || 0), 0);

      const { count: foundWithEmail } = await supabase
        .from('businesses')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .eq('status', 'found')
        .not('email', 'is', null)
        .neq('email', '');
      next.found_with_email = foundWithEmail || 0;

      const staleSince = new Date(Date.now() - 12 * 60 * 1000).toISOString();
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
        .limit(35);
      setRecentJobs((data || []) as JobRow[]);
    } catch (error) {
      console.warn('Auto Scout refresh failed', error);
      setMessage((current) => current.toLowerCase().includes('failed') ? current : 'Refresh had a small problem, but the page is still open.');
    }
  }

  useEffect(() => {
    loadStats();
    const timer = window.setInterval(loadStats, running ? 2500 : 9000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, running]);

  async function enqueuePendingNoEmail() {
    setBusy(true);
    setMessage(`Adding up to ${queueLimit.toLocaleString()} leads to the queue...`);
    emitLiveActivity({ kind: 'auto_scout', status: 'queueing', title: 'Auto Scout queueing', message: `Adding up to ${queueLimit.toLocaleString()} leads to the email-finding queue.` });
    try {
      const res = await fetch('/api/research/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: queueLimit, noEmailOnly: true })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Queue request failed.');
      setMessage(`Added ${Number(json.enqueued || 0).toLocaleString()} lead(s) to the queue. Click Start finding emails in queue.`);
      emitLiveActivity({ kind: 'auto_scout', status: 'queued', title: 'Auto Scout queue ready', message: `Added ${Number(json.enqueued || 0).toLocaleString()} lead(s) to the queue.` });
      await loadStats();
    } catch (error) {
      setMessage(`Queue failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runServerChunk() {
    const res = await fetch('/api/research/run-worker', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: workspace.id,
        autoEnqueue: false,
        cycles: 1,
        batchSize: AUTO_SCOUT_BATCH_SIZE,
        concurrency: AUTO_SCOUT_SPEED
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Auto Scout run failed.');
    return json;
  }

  async function startCheckingQueue() {
    if (busy || running) return;
    stopRef.current = false;
    setBusy(true);
    setRunning(true);
    setWorkerResult(null);
    try {
      let queued = await getQueuedCount();
      if (!queued) {
        setMessage('Queue is empty. Add leads to the queue first, then start finding emails.');
        return;
      }

      let totalProcessed = 0;
      let totalFound = 0;
      setMessage(`Checking the queue now. ${queued.toLocaleString()} lead(s) are waiting.`);
      emitLiveActivity({ kind: 'auto_scout', status: 'starting', title: 'Auto Scout starting', message: `Checking queued leads through the server runner. ${backendLabel}.` });

      for (let round = 1; round <= AUTO_SCOUT_ROUNDS_PER_CLICK; round += 1) {
        if (stopRef.current) break;
        queued = await getQueuedCount();
        if (!queued) break;
        setMessage(`Checking queue: group ${round}. ${queued.toLocaleString()} lead(s) still in queue before this group.`);
        emitLiveActivity({ kind: 'auto_scout', status: 'checking', title: 'Auto Scout checking', message: `Group ${round}: checking queued websites for emails.` });
        const json = await runServerChunk();
        setWorkerResult(json);
        totalProcessed += Number(json.processed || 0);
        totalFound += Number(json.found || 0);
        await loadStats();
        if (!Number(json.processed || 0)) break;
        await sleep(700);
      }

      queued = await getQueuedCount();
      if (stopRef.current) {
        setMessage(`Stopped after checking ${totalProcessed.toLocaleString()} lead(s). ${queued.toLocaleString()} lead(s) are still in queue. Continue checking or return them to Need Emails.`);
      } else if (queued > 0) {
        setMessage(`Checked ${totalProcessed.toLocaleString()} lead(s) and found ${totalFound.toLocaleString()} email(s). ${queued.toLocaleString()} lead(s) are still in queue. Click Continue checking queue or Return queue to Need Emails.`);
      } else {
        setMessage(`Finished the queue. Checked ${totalProcessed.toLocaleString()} lead(s) and found ${totalFound.toLocaleString()} email(s).`);
      }
      emitLiveActivity({ kind: 'auto_scout', status: queued > 0 ? 'paused' : 'complete', title: queued > 0 ? 'Auto Scout paused' : 'Auto Scout complete', message: queued > 0 ? `${queued.toLocaleString()} lead(s) are still in queue.` : `Queue finished. Found ${totalFound.toLocaleString()} email(s).` });
    } catch (error) {
      setMessage(`Auto Scout failed: ${fmtError(error)}. Any remaining queue was not marked complete.`);
      emitLiveActivity({ kind: 'auto_scout', status: 'failed', title: 'Auto Scout failed', message: fmtError(error) });
    } finally {
      setBusy(false);
      setRunning(false);
      await loadStats();
    }
  }

  async function addAndStart() {
    if (busy || running) return;
    await enqueuePendingNoEmail();
    await sleep(300);
    await startCheckingQueue();
  }

  function stopAutoScout() {
    stopRef.current = true;
    setMessage('Stopping after the current group finishes. Nothing will be called complete until the queue is empty.');
  }

  async function returnQueueToNeedEmails() {
    if (!window.confirm('Return queued leads to Need Emails? This clears the waiting queue. You can add them again later.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/research/return-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not return queue.');
      setMessage(`Returned ${Number(json.returned || 0).toLocaleString()} queued lead(s) to Need Emails.`);
      await loadStats();
    } catch (error) {
      setMessage(`Return queue failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvalidEmailValues() {
    if (!window.confirm('Remove clearly bad/fake email values and send those leads back to Need Emails?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/research/delete-invalid-emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit: 5000 })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete bad emails failed.');
      setMessage(`Removed ${Number(json.updated || 0).toLocaleString()} bad email value(s). Those leads can now be added back to the queue.`);
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
        <div className="card kpi"><div className="title">Need Emails</div><div className="num">{needsCount.toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>Same count rule as Dashboard. These leads have no usable email and are not in the queue.</div></div>
        <div className="card kpi"><div className="title">In Queue</div><div className="num">{queueCount.toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>Leads waiting for Scout to check.</div></div>
        <div className="card kpi"><div className="title">Checking Now</div><div className="num">{runningCount.toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>{runningCount ? 'Scout is checking these right now.' : 'Nothing is being checked right now.'}</div></div>
        <div className="card kpi"><div className="title">Emails Found</div><div className="num">{(stats.found_with_email || 0).toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>Trusted emails saved to leads.</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Find missing emails</h3>
            <p className="muted" style={{ margin: '6px 0 0' }}>Simple flow: add leads to the queue, then check the queue. Results appear on this page and in Live Work.</p>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>{backendLabel}{backendUrl ? `: ${backendUrl}` : ''}</p>
          </div>
          <div className="actions">
            {running ? <button className="btn secondary" onClick={stopAutoScout}>Stop</button> : null}
            <button className="btn secondary" disabled={busy || running} onClick={loadStats}>Refresh</button>
          </div>
        </div>

        <div className="grid grid-3" style={{ marginTop: 16 }}>
          <div className="soft-card">
            <h4 style={{ marginTop: 0 }}>1. Add leads to queue</h4>
            <p className="muted">Choose how many missing-email leads Scout should prepare for checking.</p>
            <div className="choice-row">
              <input className="input" style={{ width: 150 }} type="number" min={1} max={AUTO_SCOUT_QUEUE_MAX} value={queueLimit} onChange={(e) => setQueueLimit(Math.max(1, Math.min(AUTO_SCOUT_QUEUE_MAX, Number(e.target.value) || 500)))} />
              <span className="muted">Max {AUTO_SCOUT_QUEUE_MAX.toLocaleString()}</span>
            </div>
            <button className="btn secondary" disabled={busy || running} onClick={enqueuePendingNoEmail} style={{ marginTop: 12 }}>Add to queue</button>
          </div>
          <div className="soft-card">
            <h4 style={{ marginTop: 0 }}>2. Find emails in queue</h4>
            <p className="muted">Scout checks only the leads already in queue. If the queue is not finished, it will tell you.</p>
            <div className="actions">
              <button className="btn" disabled={busy || running || queueCount <= 0} onClick={startCheckingQueue}>{queueCount > 0 ? 'Start checking queue' : 'Queue is empty'}</button>
              <button className="btn secondary" disabled={busy || running || queueCount <= 0} onClick={returnQueueToNeedEmails}>Return queue to Need Emails</button>
            </div>
          </div>
          <div className="soft-card">
            <h4 style={{ marginTop: 0 }}>Quick action</h4>
            <p className="muted">Add leads and immediately start checking them. Use this when you want Scout to begin now.</p>
            <button className="btn" disabled={busy || running} onClick={addAndStart}>Add + start finding emails</button>
          </div>
        </div>

        <div className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'error' : 'notice'} style={{ marginTop: 14 }}>{message}</div>
        {workerResult ? <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Last run: queued {Number(workerResult.enqueued || 0).toLocaleString()}, checked {Number(workerResult.processed || 0).toLocaleString()}, found {Number(workerResult.found || 0).toLocaleString()}.</div> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Results</h3>
            <p className="simple-table-note" style={{ marginTop: 6 }}>Trusted emails are saved for sending. Review means check it manually. Blocked means Scout ignored it.</p>
          </div>
          <div className="actions">
            <button className="btn danger" disabled={busy || running} onClick={deleteInvalidEmailValues}>Delete invalid emails</button>
            <button className="btn secondary" type="button" onClick={loadStats}>Refresh results</button>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Result</th><th>Email</th><th>Business</th><th>Proof</th><th>Why</th></tr></thead><tbody>
          {foundRows.map((row, index) => <tr key={`${row.id || row.email}-${index}`}>
            <td><span className={`trust-pill ${row.trustTone || 'none'}`}>{row.quality || 'Review'}</span></td>
            <td>{row.email || <span className="muted">No email</span>}</td>
            <td>{row.id ? <Link href={`/businesses/${row.id}`}>{row.businessName || row.id}</Link> : row.businessName || '-'}</td>
            <td>{row.evidence ? <a href={row.evidence.startsWith('http') ? row.evidence : `https://${row.evidence}`} target="_blank" rel="noreferrer">source</a> : <span className="muted">-</span>}</td>
            <td><span className="muted">{row.reason || '-'}</span></td>
          </tr>)}
          {!foundRows.length ? <tr><td colSpan={5} className="muted">No results yet. Add leads to queue and start checking.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Recent checks</h3>
          <button className="btn secondary mini" type="button" onClick={loadStats}>Refresh</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Business</th><th>State</th><th>Email</th><th>Trust</th><th>Attempts</th></tr></thead><tbody>
          {recentJobs.map((job) => {
            const business = getBusiness(job);
            const email = String(business?.email || getEmailFromResult(job.result) || '');
            const trust = trustForEmail(email, business, job.result);
            return <tr key={job.id}><td>{business?.id ? <Link href={`/businesses/${business.id}`}><strong>{business?.name || '-'}</strong></Link> : <strong>{business?.name || '-'}</strong>}<br /><span className="muted">{business?.website || business?.domain || ''}</span></td><td><span className={`status ${job.status}`}>{job.status === 'queued' ? 'in queue' : job.status === 'running' ? 'checking now' : job.status}</span></td><td>{email || <span className="muted">No email yet</span>}</td><td><span className={`trust-pill ${trust.tone}`}>{trust.label}</span></td><td>{job.attempts || 0}</td></tr>;
          })}
          {!recentJobs.length ? <tr><td colSpan={5} className="muted">No Auto Scout checks yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
