'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PauseCircle, RefreshCw, Send, Search } from 'lucide-react';

type LiveSchedule = {
  id: string;
  type?: string | null;
  status?: string | null;
  run_kind?: string | null;
  target_count?: number | null;
  processed_count?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
  scheduled_for?: string | null;
  updated_at?: string | null;
  stop_requested?: boolean | null;
  last_error?: string | null;
};

type LiveSent = {
  id: string;
  status?: string | null;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  sent_at?: string | null;
};

type LiveResearch = {
  id: string;
  status?: string | null;
  attempts?: number | null;
  last_error?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
};

type LiveLog = Record<string, any>;

type LivePayload = {
  success?: boolean;
  error?: string;
  schedules?: LiveSchedule[];
  recentSent?: LiveSent[];
  researchJobs?: LiveResearch[];
  logs?: LiveLog[];
  checkedAt?: string;
};

function fmtTime(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function pct(schedule: LiveSchedule) {
  const total = Number(schedule.target_count || 0);
  const done = Number(schedule.processed_count || schedule.sent_count || 0);
  if (!total || total < 1) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function shortEmail(value?: string | null) {
  const email = String(value || '');
  if (email.length <= 28) return email;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 10)}…@${domain || ''}`;
}

export function LiveActivityWindow({ workspaceId }: { workspaceId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<LivePayload>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stopId, setStopId] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<string>('unsupported');
  const lastNotifiedSentId = useRef<string>('');
  const lastNotifiedScheduleKey = useRef<string>('');

  const runningSchedules = useMemo(() => (payload.schedules || []).filter((row) => ['running', 'due', 'scheduled'].includes(String(row.status || ''))), [payload.schedules]);
  const runningResearch = useMemo(() => (payload.researchJobs || []).filter((row) => ['running', 'queued'].includes(String(row.status || ''))), [payload.researchJobs]);
  const hasWork = runningSchedules.length > 0 || runningResearch.some((row) => row.status === 'running');

  async function load() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/activity/live?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Activity check failed with HTTP ${response.status}`);
      setPayload(json);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function stopSchedule(scheduleId: string) {
    if (!workspaceId) return;
    setStopId(scheduleId);
    try {
      const response = await fetch('/api/message/stop-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, scheduleId })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Stop failed with HTTP ${response.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopId('');
    }
  }

  async function enableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function notify(title: string, body: string) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/icon-192.png', tag: 'scout-live-work' });
    n.onclick = () => {
      window.focus();
      window.location.href = '/message';
    };
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const latestSent = (payload.recentSent || [])[0];
    if (latestSent?.id && latestSent.id !== lastNotifiedSentId.current) {
      if (lastNotifiedSentId.current) notify('Scout sent an email', `${shortEmail(latestSent.to_email)} from ${shortEmail(latestSent.from_email)}`);
      lastNotifiedSentId.current = latestSent.id;
    }
    const active = (payload.schedules || []).find((row) => row.status === 'running');
    const key = active ? `${active.id}:${active.processed_count || 0}:${active.sent_count || 0}` : '';
    if (key && key !== lastNotifiedScheduleKey.current) {
      if (lastNotifiedScheduleKey.current) notify('Scout sending progress', `${Number(active?.sent_count || 0).toLocaleString()} sent · ${Number(active?.processed_count || 0).toLocaleString()} processed`);
      lastNotifiedScheduleKey.current = key;
    }
  }, [payload]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, hasWork ? 5000 : 12000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, hasWork]);

  if (!workspaceId) return null;

  return (
    <div className={`live-activity ${open ? 'open' : ''}`}>
      <button className="live-activity-tab" type="button" onClick={() => setOpen((value) => !value)}>
        {loading || hasWork ? <Loader2 size={15} className="spin" /> : <span className="live-dot" />}
        <span>{open ? 'Hide work' : (hasWork ? 'Working now' : 'Live work')}</span>
      </button>
      {open ? (
        <div className="live-activity-panel">
          <div className="live-activity-head">
            <div>
              <strong>Live work</strong>
              <p>Sending and Auto Scout progress.</p>
            </div>
            <div className="actions" style={{ gap: 6 }}>
              {notificationPermission !== 'granted' ? (
                <button className="btn secondary mini" type="button" onClick={enableNotifications} title="Enable desktop notifications">
                  Notify me
                </button>
              ) : null}
              <button className="icon-btn" type="button" onClick={load} disabled={loading} title="Refresh">
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          {error ? <div className="notification-error">{error}</div> : null}
          <div className="live-activity-list">
            {(payload.schedules || []).slice(0, 4).map((schedule) => {
              const percent = pct(schedule);
              const sent = Number(schedule.sent_count || 0);
              const processed = Number(schedule.processed_count || 0);
              const total = Number(schedule.target_count || 0);
              const isActive = ['running', 'due', 'scheduled'].includes(String(schedule.status || ''));
              return (
                <div className="live-card" key={schedule.id}>
                  <div className="live-card-title"><Send size={14} /> <strong>{schedule.type === 'follow_up' ? 'Follow-up job' : 'Email job'}</strong><span>{schedule.status}</span></div>
                  <div className="progress-track slim"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
                  <p>{processed || sent} processed · {sent} sent{total ? ` · ${total} total` : ''}</p>
                  {schedule.last_error ? <p className="bad-text">{schedule.last_error}</p> : null}
                  {isActive ? <button className="btn secondary mini" type="button" disabled={Boolean(stopId)} onClick={() => stopSchedule(schedule.id)}>{stopId === schedule.id ? 'Stopping…' : 'Stop'}</button> : null}
                </div>
              );
            })}

            {runningResearch.length ? (
              <div className="live-card">
                <div className="live-card-title"><Search size={14} /> <strong>Auto Scout</strong><span>{runningResearch.length} active/queued</span></div>
                <p>Checking websites and looking for real contact emails.</p>
                {runningResearch.slice(0, 3).map((job) => <p key={job.id} className="muted">{job.status} · attempt {job.attempts || 0} · {fmtTime(job.updated_at || job.created_at)}</p>)}
              </div>
            ) : null}

            {(payload.recentSent || []).slice(0, 5).map((row) => (
              <div className="live-line" key={row.id}>
                <span>{row.status === 'sent' ? 'Sent' : row.status || 'Email'}</span>
                <strong>{shortEmail(row.to_email)}</strong>
                <em>{fmtTime(row.sent_at)}</em>
              </div>
            ))}

            {!runningSchedules.length && !runningResearch.length && !(payload.recentSent || []).length ? (
              <div className="notification-empty">No live sending or Auto Scout work right now.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
