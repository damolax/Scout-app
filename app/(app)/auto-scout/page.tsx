import { getCurrentWorkspace } from '@/lib/workspace';
import AutoScoutClient from './AutoScoutClient';

export default async function AutoScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Auto Scout</h2><p>Queue backend email research so work can continue from cloud data, not only the active browser tab.</p></div>
      <AutoScoutClient workspace={workspace} />
    </div>
  );
}
