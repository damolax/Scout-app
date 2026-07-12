'use client';

import { Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';

type LevelData = {
  success?: boolean;
  points?: number;
  stageNumber?: number;
  totalStages?: number;
  progress?: number;
  current?: { name: string; min: number };
  next?: { name: string; min: number } | null;
  highlights?: Record<string, number>;
};

export function ScoutingLevel({ workspaceId }: { workspaceId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LevelData | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    async function load() {
      const response = await fetch(`/api/scouting-level?workspaceId=${encodeURIComponent(workspaceId || '')}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (alive) setData(json);
    }
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [workspaceId]);

  if (!workspaceId) return null;
  const stageName = data?.current?.name || 'Novice';
  const progress = Number(data?.progress || 0);
  const points = Number(data?.points || 0);
  const highlights = data?.highlights || {};

  return (
    <div className="scouting-level-wrap">
      <button className="scouting-level-button" type="button" onClick={() => setOpen((current) => !current)}>
        <Trophy size={17} />
        <span>
          <strong>Scouting Level</strong>
          <small>{stageName} · {progress}%</small>
        </span>
      </button>
      {open ? (
        <div className="scouting-level-card">
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ margin: 0 }}>{stageName}</h3>
              <p className="muted" style={{ margin: '4px 0 0' }}>Stage {data?.stageNumber || 1} of {data?.totalStages || 12}</p>
            </div>
            <button className="btn secondary mini" type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="progress-track" style={{ marginTop: 12 }}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <p className="muted" style={{ fontSize: 12 }}>Points grow when you find trusted emails, send messages, get real replies, reply to prospects, connect senders, create templates, and keep working inside Scout. The next stage is hidden so it stays fun.</p>
          <div className="level-mini-grid">
            <span>Messages <strong>{Number(highlights.deliveredMessages || 0).toLocaleString()}</strong></span>
            <span>Trusted emails <strong>{Number(highlights.trustedEmails || 0).toLocaleString()}</strong></span>
            <span>Real replies <strong>{Number(highlights.realReplies || 0).toLocaleString()}</strong></span>
            <span>Your replies <strong>{Number(highlights.manualReplies || 0).toLocaleString()}</strong></span>
          </div>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>Total points: {points.toLocaleString()}</p>
        </div>
      ) : null}
    </div>
  );
}
