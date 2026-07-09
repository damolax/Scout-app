import { getCurrentWorkspace } from '@/lib/workspace';
import SourceScoutClient from './SourceScoutClient';

export default async function SourceScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Source Scout</h2>
        <p>Google/Bing dork workflow, directory result parsing, extension bridge, and Auto Scout handoff.</p>
      </div>
      <SourceScoutClient workspace={workspace} />
    </div>
  );
}
