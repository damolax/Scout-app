import { getCurrentWorkspace } from '@/lib/workspace';

export default async function EmailScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Email Scout</h2><p>Sending, Gmail OAuth, reply checks, and bounce/no-inbox logic stay on your backend.</p></div>
      <div className="card" style={{ padding: 18 }}>
        <h3>Backend kept on purpose</h3>
        <p className="muted">Supabase is used for login and data sync. Gmail send/read still needs OAuth tokens, Gmail API calls, rate handling, and bounce filtering, so the old backend should remain responsible for that.</p>
        <a className="btn secondary" href="/settings">Check backend URL</a>
      </div>
    </div>
  );
}
