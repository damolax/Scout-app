import { getCurrentWorkspace } from '@/lib/workspace';
import RepliesClient from './RepliesClient';

export default async function RepliesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Replies</h2>
        <p>Review real prospect responses first. Automatic messages and delivery problems stay separated below.</p>
      </div>
      <RepliesClient workspace={workspace} />
    </div>
  );
}
