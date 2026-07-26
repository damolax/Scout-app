'use client';

import { useEffect, useRef, useState } from 'react';

function isTransient(error: Error) {
  return /timeout|57014|network|fetch|connection|supabase|temporar|503/i.test(`${error.name} ${error.message}`);
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const attempts = useRef(0);
  const [retrying, setRetrying] = useState(false);
  const retryLimit = isTransient(error) ? 2 : 1;

  useEffect(() => {
    console.error('Scout root error:', error);
    if (attempts.current >= retryLimit) return;
    attempts.current += 1;
    setRetrying(true);
    const timer = window.setTimeout(() => {
      reset();
      setRetrying(false);
    }, attempts.current * 1100);
    return () => window.clearTimeout(timer);
  }, [error, reset, retryLimit]);

  return (
    <main className="container" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
      <section className="card stack" style={{ width: '100%', maxWidth: 640, padding: 28 }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>Scout could not finish this request</h2>
          <p className="muted">
            Your saved data was not deleted. Scout is retrying the page safely without repeating a completed send, import or delete action.
          </p>
        </div>
        {retrying ? <div className="notice">Temporary interruption detected. Retrying…</div> : null}
        <div className="actions">
          <button className="btn" type="button" disabled={retrying} onClick={() => reset()}>{retrying ? 'Retrying…' : 'Try again'}</button>
          <button className="btn secondary" type="button" onClick={() => window.location.reload()}>Reload Scout</button>
          <a className="btn secondary" href="/dashboard">Go to dashboard</a>
        </div>
        {error.digest ? <p className="muted" style={{ fontSize: 12 }}>Reference: {error.digest}</p> : null}
      </section>
    </main>
  );
}
