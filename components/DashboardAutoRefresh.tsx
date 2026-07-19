'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardAutoRefresh({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefresh, setLastRefresh] = useState(generatedAt);

  function refresh() {
    startTransition(() => {
      router.refresh();
      setLastRefresh(new Date().toISOString());
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Updated {new Date(lastRefresh).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
      <button className="btn secondary mini" type="button" onClick={refresh} disabled={isPending}>
        {isPending ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
