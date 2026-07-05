import { getCurrentWorkspace } from '@/lib/workspace';

export default async function VerifyPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Verify Emails</h2><p>Cloud-ready placeholder page for verifier flow.</p></div>
      <div className="card" style={{ padding: 18 }}>
        <h3>How this will work</h3>
        <p className="muted">The frontend stores candidates in Supabase. The existing backend remains responsible for heavier email verification/enrichment endpoints. This page is intentionally separated from Upload and Dashboard so verifier changes cannot break imports.</p>
        <div className="notice">Backend URL is configured with NEXT_PUBLIC_BACKEND_URL.</div>
      </div>
    </div>
  );
}
