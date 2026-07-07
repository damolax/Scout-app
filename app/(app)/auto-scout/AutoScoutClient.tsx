'use client';

import { useState } from 'react';
import type { Workspace } from '@/lib/types';

function fmtError(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export default function AutoScoutClient({ workspace }: { workspace: Workspace }) {
  const [limit, setLimit] = useState(1000);
  const [message, setMessage] = useState('Ready. This queues email research in Supabase so it can keep progressing by backend/cron even when you are not focused on the app.');
  const [busy, setBusy] = useState(false);

  async function enqueue() {
    setBusy(true);
    setMessage(`Enqueuing up to ${limit.toLocaleString()} pending businesses...`);
    try {
      const res = await fetch('/api/research/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, limit })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Queue request failed.');
      setMessage(`Queued ${Number(json.enqueued || 0).toLocaleString()} email research job(s). Checked ${Number(json.checked || 0).toLocaleString()} business(es).`);
    } catch (error) {
      setMessage(`Queue failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runOnce() {
    setBusy(true);
    setMessage('Running one backend research cycle now...');
    try {
      const res = await fetch('/api/research/run-once?limit=10', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Run request failed.');
      setMessage(`Research cycle processed ${Number(json.processed || 0).toLocaleString()} job(s).`);
    } catch (error) {
      setMessage(`Run failed: ${fmtError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card" style={{ padding: 18 }}>
        <h3>Cloud Email Research Queue</h3>
        <p className="muted">This is the v8.1 background foundation. Upload contacts into Supabase, queue pending businesses here, and the backend runner processes jobs in small batches. The page does not need to stay focused for progress to be saved.</p>
        <label className="label">Businesses to queue now</label>
        <input className="input" type="number" min={1} max={10000} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(10000, Number(e.target.value) || 1000)))} />
        <div className="actions">
          <button className="btn" disabled={busy} onClick={enqueue}>{busy ? 'Working...' : 'Queue Pending Businesses'}</button>
          <button className="btn secondary" disabled={busy} onClick={runOnce}>Run 10 Now</button>
        </div>
        <div className="notice">{message}</div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Important</h3>
        <p className="muted">Vercel Cron is configured to hit <code>/api/research/run-once</code> every 15 minutes. For heavy 100,000-contact jobs, the permanent version should move the long worker into your backend/Render process, while this app remains the cloud dashboard and queue.</p>
      </div>
    </div>
  );
}
