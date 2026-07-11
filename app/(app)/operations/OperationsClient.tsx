'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GmailAccount, MessageSchedule, Workspace } from '@/lib/types';

type StepResult = {
  key: string;
  label: string;
  status: 'success' | 'skipped' | 'failed';
  startedAt: string;
  finishedAt: string;
  metrics?: Record<string, unknown>;
  error?: string;
};

type WorkerResult = {
  success?: boolean;
  workspaceId?: string;
  startedAt?: string;
  finishedAt?: string;
  completed?: number;
  failed?: number;
  skipped?: number;
  steps?: StepResult[];
  error?: string;
};

type Counts = {
  ready: number;
  pending: number;
  contacted: number;
  responded: number;
  noInbox: number;
  bounced: number;
  dueSchedules: number;
  dueFollowUps: number;
  activeSenders: number;
  pausedSenders: number;
};

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function localTime(value?: string) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function valuePreview(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length.toLocaleString()} item(s)`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 6);
    return entries.map(([key, val]) => `${key}: ${typeof val === 'number' ? val.toLocaleString() : Array.isArray(val) ? `${val.length} item(s)` : String(val)}`).join(' · ');
  }
  return String(value);
}

export default function OperationsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [counts, setCounts] = useState<Counts>({ ready: 0, pending: 0, contacted: 0, responded: 0, noInbox: 0, bounced: 0, dueSchedules: 0, dueFollowUps: 0, activeSenders: 0, pausedSenders: 0 });
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [schedules, setSchedules] = useState<MessageSchedule[]>([]);
  const [logs, setLogs] = useState<Array<Record<string, any>>>([]);
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Ready.');
  const [includeSeedTest, setIncludeSeedTest] = useState(false);
  const [includeAutoScout, setIncludeAutoScout] = useState(true);
  const [includeSchedules, setIncludeSchedules] = useState(true);
  const [includeReplies, setIncludeReplies] = useState(true);
  const [includeBounces, setIncludeBounces] = useState(true);
  const [includeRepairReady, setIncludeRepairReady] = useState(true);
  const [replyLimit, setReplyLimit] = useState(100);
  const [scheduleLimit, setScheduleLimit] = useState(3);
  const [scheduleBatchSize, setScheduleBatchSize] = useState(100);
  const [senderRunLimit, setSenderRunLimit] = useState(50);
  const [autoScoutCycles, setAutoScoutCycles] = useState(5);
  const [last24BySender, setLast24BySender] = useState<Record<string, number>>({});

  async function countBusiness(statuses: string[]) {
    let query = supabase.from('businesses').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace.id);
    if (statuses.length === 1) query = query.eq('status', statuses[0]);
    else query = query.in('status', statuses);
    const { count } = await query;
    return count || 0;
  }

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [{ data: accountRows }, { data: scheduleRows }, { data: logRows }, { data: sentRows }] = await Promise.all([
        supabase.from('gmail_accounts').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
        supabase.from('message_schedules').select('*').eq('workspace_id', workspace.id).in('status', ['scheduled', 'due', 'running']).order('scheduled_for', { ascending: true }).limit(20),
        supabase.from('activity_logs').select('*').eq('workspace_id', workspace.id).in('type', ['worker_run', 'worker_warning']).order('created_at', { ascending: false }).limit(8),
        supabase.from('sent_messages').select('gmail_account_id,from_email').eq('workspace_id', workspace.id).eq('status', 'sent').gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(50000)
      ]);

      const accountList = (accountRows || []) as GmailAccount[];
      const scheduleList = (scheduleRows || []) as MessageSchedule[];
      const last24: Record<string, number> = {};
      for (const row of (sentRows || []) as Array<Record<string, any>>) {
        const accountId = String(row.gmail_account_id || '');
        const email = String(row.from_email || '').toLowerCase();
        if (accountId) last24[accountId] = (last24[accountId] || 0) + 1;
        if (email) last24[email] = (last24[email] || 0) + 1;
      }
      const activeSenders = accountList.filter((a) => ['connected', 'ready'].includes(String(a.status || '')) && (a.access_token || a.refresh_token) && (!a.paused_until || new Date(a.paused_until).getTime() <= Date.now())).length;
      const pausedSenders = accountList.filter((a) => a.paused_until && new Date(a.paused_until).getTime() > Date.now()).length;
      const dueScheduleCount = scheduleList.filter((s) => new Date(s.scheduled_for).getTime() <= Date.now()).length;
      let dueFollowUps = 0;
      try {
        const { data: dueRows } = await supabase.rpc('get_due_followups', { target_workspace: workspace.id, limit_rows: 5000, followup_segment: 'all_unanswered' });
        dueFollowUps = (dueRows || []).length;
      } catch {
        dueFollowUps = 0;
      }

      const [ready, pending, contacted, responded, noInbox, bounced] = await Promise.all([
        countBusiness(['ready']),
        countBusiness(['pending', 'found', 'review']),
        countBusiness(['contacted']),
        countBusiness(['responded']),
        countBusiness(['no_inbox']),
        countBusiness(['bounced'])
      ]);

      setAccounts(accountList);
      setLast24BySender(last24);
      setSchedules(scheduleList);
      setLogs((logRows || []) as Array<Record<string, any>>);
      setCounts({ ready, pending, contacted, responded, noInbox, bounced, dueSchedules: dueScheduleCount, dueFollowUps, activeSenders, pausedSenders });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  async function runWorker(mode: 'full' | 'inbox' | 'schedules' | 'autoscout') {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload = {
        workspaceId: workspace.id,
        includeReplies: mode === 'full' ? includeReplies : mode === 'inbox',
        includeBounces: mode === 'full' ? includeBounces : mode === 'inbox',
        includeRepairReady: mode === 'full' ? includeRepairReady : false,
        includeSchedules: mode === 'full' ? includeSchedules : mode === 'schedules',
        includeAutoScout: mode === 'full' ? includeAutoScout : mode === 'autoscout',
        includeSeedTest: mode === 'full' ? includeSeedTest : false,
        replyLimit,
        scheduleLimit,
        scheduleBatchSize,
        senderRunLimit,
        autoScoutCycles
      };
      setStatus(mode === 'full' ? 'Running due work...' : `Running ${mode} worker...`);
      const response = await fetch('/api/workers/run-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) throw new Error(json?.error || `Worker failed with HTTP ${response.status}`);
      setResult(json);
      setStatus(`Worker finished. Completed ${Number(json.completed || 0).toLocaleString()}, failed ${Number(json.failed || 0).toLocaleString()}, skipped ${Number(json.skipped || 0).toLocaleString()}.`);
      await refresh();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <div className="eyebrow">Automation</div>
          <h1>Worker</h1>
        </div>
        <div className="actions">
          <button className="btn" type="button" disabled={busy || loading} onClick={() => runWorker('full')}>Run due work</button>
          <button className="btn secondary" type="button" disabled={busy || loading} onClick={refresh}>Refresh</button>
        </div>
      </div>

      {error ? <div className="alert bad">{error}</div> : null}
      <div className="notice">{busy ? 'Working...' : loading ? 'Loading...' : status}</div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Ready leads</div><div className="num">{counts.ready.toLocaleString()}</div><p>Can receive a first email</p></div>
        <div className="card kpi"><div className="title">Follow-ups due</div><div className="num">{counts.dueFollowUps.toLocaleString()}</div><p>People to follow up</p></div>
        <div className="card kpi"><div className="title">Senders ready</div><div className="num">{counts.activeSenders.toLocaleString()}</div><p>{counts.pausedSenders.toLocaleString()} paused/limited</p></div>
        <div className="card kpi"><div className="title">Scheduled sends due</div><div className="num">{counts.dueSchedules.toLocaleString()}</div><p>Ready to send now</p></div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Need email</div><div className="num">{counts.pending.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Contacted</div><div className="num">{counts.contacted.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Responded</div><div className="num">{counts.responded.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Bad inboxes</div><div className="num">{(counts.noInbox + counts.bounced).toLocaleString()}</div><p>Bounced or blocked</p></div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Choose what to run</h3>
          <div className="grid grid-2">
            <label className="checkbox-row"><input type="checkbox" checked={includeBounces} onChange={(e) => setIncludeBounces(e.target.checked)} /> Check bad inboxes</label>
            <label className="checkbox-row"><input type="checkbox" checked={includeReplies} onChange={(e) => setIncludeReplies(e.target.checked)} /> Check replies</label>
            <label className="checkbox-row"><input type="checkbox" checked={includeRepairReady} onChange={(e) => setIncludeRepairReady(e.target.checked)} /> Clean lead status</label>
            <label className="checkbox-row"><input type="checkbox" checked={includeSchedules} onChange={(e) => setIncludeSchedules(e.target.checked)} /> Send due emails</label>
            <label className="checkbox-row"><input type="checkbox" checked={includeAutoScout} onChange={(e) => setIncludeAutoScout(e.target.checked)} /> Find missing emails</label>
            <label className="checkbox-row"><input type="checkbox" checked={includeSeedTest} onChange={(e) => setIncludeSeedTest(e.target.checked)} /> Send test email</label>
          </div>
          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <div><label className="label">Inbox to check per sender</label><input className="input" type="number" min={1} max={500} value={replyLimit} onChange={(e) => setReplyLimit(Number(e.target.value || 100))} /></div>
            <div><label className="label">Schedules to open</label><input className="input" type="number" min={1} max={25} value={scheduleLimit} onChange={(e) => setScheduleLimit(Number(e.target.value || 3))} /></div>
            <div><label className="label">Emails this run</label><input className="input" type="number" min={1} max={2000} value={scheduleBatchSize} onChange={(e) => setScheduleBatchSize(Number(e.target.value || 100))} /></div>
            <div><label className="label">Max from each sender</label><input className="input" type="number" min={1} max={2000} value={senderRunLimit} onChange={(e) => setSenderRunLimit(Number(e.target.value || 50))} /></div>
            <div><label className="label">Email-finder passes</label><input className="input" type="number" min={1} max={25} value={autoScoutCycles} onChange={(e) => setAutoScoutCycles(Number(e.target.value || 5))} /></div>
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => runWorker('full')}>Run due work</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => runWorker('inbox')}>Check Replies</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => runWorker('schedules')}>Send Due Emails</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => runWorker('autoscout')}>Find Emails</button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Sender Limits</h3>
          <div className="table-wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Last 24h</th><th>Risk</th></tr></thead><tbody>
            {accounts.slice(0, 20).map((account) => {
              const emailKey = String(account.email || '').toLowerCase();
              const sent24 = last24BySender[String(account.id)] ?? last24BySender[emailKey] ?? Number(account.sent_today || 0);
              const dailyLimit = Number(account.daily_limit || 0);
              return <tr key={account.id}><td>{account.email}</td><td>{account.paused_until && new Date(account.paused_until).getTime() > Date.now() ? `paused until ${localTime(account.paused_until)}` : account.status}</td><td><span className="badge">{Number(sent24 || 0).toLocaleString()} sent last 24h</span><br /><span className="muted">Daily cap: {dailyLimit ? dailyLimit.toLocaleString() : 'not set'}</span></td><td>{account.spam_risk_status || account.last_seed_result || '-'}</td></tr>;
            })}
            {!accounts.length ? <tr><td colSpan={4} className="muted">No Gmail senders connected yet.</td></tr> : null}
          </tbody></table></div>
          <h3 style={{ marginTop: 18 }}>Saved Schedules</h3>
          <div className="table-wrap"><table><thead><tr><th>Type</th><th>For</th><th>Count</th><th>Status</th></tr></thead><tbody>
            {schedules.slice(0, 8).map((schedule) => <tr key={schedule.id}><td>{schedule.type}</td><td>{localTime(schedule.scheduled_for)}</td><td>{Number(schedule.target_count || 0).toLocaleString()}</td><td>{schedule.status}</td></tr>)}
            {!schedules.length ? <tr><td colSpan={4} className="muted">No saved schedules yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>

      {result ? <div className="card" style={{ padding: 18 }}>
        <h3>Last Run</h3>
        <p className="muted">Started {localTime(result.startedAt)} · Finished {localTime(result.finishedAt)}</p>
        <div className="table-wrap"><table><thead><tr><th>Step</th><th>Status</th><th>Result</th></tr></thead><tbody>
          {(result.steps || []).map((step) => <tr key={step.key}><td><strong>{step.label}</strong></td><td>{step.status}</td><td>{step.error || valuePreview(step.metrics)}</td></tr>)}
        </tbody></table></div>
      </div> : null}

      <div className="card" style={{ padding: 18 }}>
        <h3>Recent Worker Logs</h3>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Type</th><th>Message</th></tr></thead><tbody>
          {logs.map((log) => <tr key={log.id}><td>{localTime(log.created_at)}</td><td>{log.type}</td><td>{log.message}</td></tr>)}
          {!logs.length ? <tr><td colSpan={3} className="muted">No logs yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
