import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import ScoutClient from './ScoutClient';

export default async function ScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Scout</h2>
        <p>Choose who you want to find. Scout changes the search, qualification and enrichment workflow for that prospect type.</p>
      </div>
      <ScoutClient workspaceId={workspace.id} />
      <div className="actions">
        <Link className="btn secondary" href="/upload">Upload a list</Link>
        <Link className="btn secondary" href="/source-scout">Advanced source tools</Link>
        <Link className="btn secondary" href="/auto-scout">Email enrichment queue</Link>
      </div>
    </div>
  );
}
