'use client';

import { useMemo, useState } from 'react';
type Challenge = {
  id: string;
  icon: string;
  title: string;
  metric: string;
  target: number;
  steps: string[];
};

type Props = {
  challenges: Challenge[];
  metrics: Record<string, number>;
};

function percent(value: number, target: number) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export default function ChallengeBoard({ challenges, metrics }: Props) {
  const [selected, setSelected] = useState<Challenge | null>(null);
  const completed = useMemo(() => challenges.filter((item) => Number(metrics[item.metric] || 0) >= item.target).length, [challenges, metrics]);
  const next = useMemo(() => challenges.filter((item) => Number(metrics[item.metric] || 0) < item.target).slice(0, 8), [challenges, metrics]);

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Challenges</h2>
          <p>Small goals that show you exactly what to do next.</p>
        </div>
        <span className="badge">{completed.toLocaleString()} / {challenges.length.toLocaleString()} complete</span>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Delivered messages</div><div className="num">{Number(metrics.deliveredMessages || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Trusted emails</div><div className="num">{Number(metrics.trustedEmails || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Real replies</div><div className="num">{Number(metrics.realReplies || 0).toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Gmail accounts</div><div className="num">{Number(metrics.gmailAccounts || 0).toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Next best challenges</h3>
        <p className="muted">Click any card to see the simple steps.</p>
        <div className="challenge-grid" style={{ marginTop: 12 }}>
          {next.map((item) => {
            const value = Number(metrics[item.metric] || 0);
            return (
              <button className="challenge-card" key={item.id} type="button" onClick={() => setSelected(item)}>
                <span className="challenge-icon">{item.icon}</span>
                <strong>{item.title}</strong>
                <small>{value.toLocaleString()} / {item.target.toLocaleString()}</small>
                <div className="progress-track slim"><div className="progress-fill" style={{ width: `${percent(value, item.target)}%` }} /></div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>All challenges</h3>
        <div className="challenge-grid">
          {challenges.map((item) => {
            const value = Number(metrics[item.metric] || 0);
            const done = value >= item.target;
            return (
              <button className={`challenge-card ${done ? 'done' : ''}`} key={item.id} type="button" onClick={() => setSelected(item)}>
                <span className="challenge-icon">{item.icon}</span>
                <strong>{done ? '✓ ' : ''}{item.title}</strong>
                <small>{value.toLocaleString()} / {item.target.toLocaleString()}</small>
                <div className="progress-track slim"><div className="progress-fill" style={{ width: `${percent(value, item.target)}%` }} /></div>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="actions" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="challenge-icon big">{selected.icon}</div>
                <h3 style={{ margin: '8px 0 0' }}>{selected.title}</h3>
                <p className="muted">Current: {Number(metrics[selected.metric] || 0).toLocaleString()} / {selected.target.toLocaleString()}</p>
              </div>
              <button className="btn secondary mini" type="button" onClick={() => setSelected(null)}>Close</button>
            </div>
            <ol className="simple-steps">
              {selected.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
