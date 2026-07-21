'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  workspaceId: string;
  scheduleId: string;
  action: 'stop' | 'continue';
  label: string;
};

export default function DashboardJobAction({ workspaceId, scheduleId, action, label }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  async function run() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const endpoint = action === 'stop' ? '/api/message/stop-schedule' : '/api/message/continue-schedule';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, scheduleId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(String(result?.error || `Request failed with HTTP ${response.status}.`));
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button className="btn secondary mini" type="button" onClick={run} disabled={busy}>
        {busy ? 'Working…' : label}
      </button>
      {error ? <span style={{ color: 'var(--bad)', fontSize: 11, maxWidth: 220, textAlign: 'right' }}>{error}</span> : null}
    </div>
  );
}
