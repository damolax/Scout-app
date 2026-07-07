import { getCurrentWorkspace } from '@/lib/workspace';
import RepliesClient from './RepliesClient';

export default async function RepliesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Replies</h2><p>Real response tracking, bounce/no-inbox separation, template performance, and sender performance.</p></div>
      <RepliesClient workspace={workspace} />
    </div>
  );
}
