'use client';

import { useEffect, useRef, useState } from 'react';

function isTransientPageError(error: Error) {
  const text = `${error.message || ''} ${error.name || ''}`.toLowerCase();
  return text.includes('timeout')
    || text.includes('57014')
    || text.includes('network')
    || text.includes('fetch')
    || text.includes('connection')
    || text.includes('supabase')
    || text.includes('temporarily')
    || text.includes('503');
}

export default function ScoutPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const attempts = useRef(0);
  const [retrying, setRetrying] = useState(false);
  const maxAutomaticRetries = isTransientPageError(error) ? 2 : 1;

  useEffect(() => {
    console.error('Scout page error:', error);
    if (attempts.current >= maxAutomaticRetries) return;
    attempts.current += 1;
    setRetrying(true);
    const timer = window.setTimeout(() => {
      reset();
      setRetrying(false);
    }, 900 * attempts.current);
    return () => window.clearTimeout(timer);
  }, [error, maxAutomaticRetries, reset]);

  return (
    <section className="card stack" style={{ width: '100%', maxWidth: 720, margin: '24px auto', padding: 28 }}>
      <div>
        <h2 style={{ marginBottom: 8 }}>This Scout page was temporarily interrupted</h2>
        <p className="muted">
          Your saved leads, sender settings and jobs were not deleted. Scout kept the menu available and is safely retrying only this page request.
        </p>
      </div>
      {retrying ? <div className="notice">Retrying this page automatically…</div> : null}
      <div className="actions">
        <button className="btn" type="button" disabled={retrying} onClick={() => reset()}>
          {retrying ? 'Retrying…' : 'Try this page again'}
        </button>
        <button className="btn secondary" type="button" onClick={() => window.location.reload()}>Reload Scout</button>
        <a className="btn secondary" href="/dashboard">Go to dashboard</a>
      </div>
      {error.digest ? <p className="muted" style={{ fontSize: 12 }}>Reference: {error.digest}</p> : null}
    </section>
  );
}
