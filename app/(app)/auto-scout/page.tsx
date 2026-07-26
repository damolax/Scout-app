import { getCurrentWorkspace } from '@/lib/workspace';
import AutoScoutClient from './AutoScoutClient';

export default async function AutoScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Find Missing Emails</h2><p>Scout follows the saved business website, prioritizes real contact pages, rejects publisher/platform pages, and saves only same-site trusted emails.</p></div>
      <AutoScoutClient workspace={workspace} />
    </div>
  );
}
