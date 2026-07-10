import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import RepliesClient from './RepliesClient';

export default async function RepliesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Inbox</h2><p>Real replies, auto replies, no-inbox/bounce issues, template performance, and sender performance.</p></div>
      <div className="quick-links">
        <Link href="/no-inbox" className="quick-link-card"><strong>No inbox / blocked</strong><span>Clean bounced, blocked, and unavailable addresses.</span></Link>
        <Link href="/operations" className="quick-link-card"><strong>Sync now</strong><span>Run reply and bounce sync from the automation page.</span></Link>
      </div>
      <RepliesClient workspace={workspace} />
    </div>
  );
}
