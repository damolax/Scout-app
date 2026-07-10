'use client';

import { useEffect, useMemo, useState } from 'react';
import { DASHBOARD_SEND_MARKETS, recommendSendWindow } from '@/lib/send-time-intelligence';

function toneStyles(tone: string) {
  if (tone === 'ok') return { borderColor: 'rgba(22,163,74,.28)', background: 'rgba(22,163,74,.06)' };
  if (tone === 'good') return { borderColor: 'rgba(37,99,235,.24)', background: 'rgba(37,99,235,.05)' };
  if (tone === 'wait') return { borderColor: 'rgba(217,119,6,.24)', background: 'rgba(217,119,6,.06)' };
  return { borderColor: 'rgba(220,38,38,.24)', background: 'rgba(220,38,38,.05)' };
}

export default function SendTimeStrip() {
  const [now, setNow] = useState(() => new Date());
  const [userTimezone, setUserTimezone] = useState('UTC');

  useEffect(() => {
    try {
      setUserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {
      setUserTimezone('UTC');
    }
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const cards = useMemo(() => DASHBOARD_SEND_MARKETS.map((market) => ({
    market,
    recommendation: recommendSendWindow({ marketTimezone: market.timezone, userTimezone, now })
  })), [now, userTimezone]);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Best Sending Time</h3>
          <p className="muted" style={{ margin: '6px 0 0' }}>Scout scores the buyer's local inbox window, but every recommended schedule time below is shown in your timezone: <b>{userTimezone}</b>.</p>
        </div>
        <span className="badge">compact</span>
      </div>
      <div className="grid grid-3" style={{ marginTop: 12 }}>
        {cards.map(({ market, recommendation }) => (
          <div key={market.id} className="card" style={{ padding: 12, boxShadow: 'none', ...toneStyles(recommendation.tone) }} title={`Buyer local time: ${recommendation.marketLocalTime} (${market.timezone})`}>
            <div className="actions" style={{ justifyContent: 'space-between', gap: 8 }}>
              <strong>{market.label}</strong>
              <span className="badge">{recommendation.label}</span>
            </div>
            <div style={{ marginTop: 8, fontWeight: 900 }}>
              {recommendation.nextBestUserTime ? `Next: ${recommendation.nextBestUserTime}` : 'Send now'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{market.note || 'Recommendation shown in your time'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
