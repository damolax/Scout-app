import { getCurrentWorkspace } from '@/lib/workspace';

export default async function AutoScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Auto Scout</h2><p>Use this page for queue controls while the extension keeps doing dorking/directory scouting in the browser.</p></div>
      <div className="card" style={{ padding: 18 }}>
        <h3>Extension remains login-free</h3>
        <p className="muted">The extension can continue using the current browser session and exporting CSVs. If later you want direct push, Settings contains a workspace API key that the extension can store locally without user login.</p>
      </div>
    </div>
  );
}
