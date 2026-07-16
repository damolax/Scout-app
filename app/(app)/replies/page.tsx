import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import RepliesClient from './RepliesClient';
import { featureFlags } from '@/lib/feature-flags';

export default async function RepliesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Replies</h2><p>See every reply Scout detected, plus inbox problems like bounces and blocked messages.</p></div>
      <div className="quick-links">
        <Link href="/no-inbox" className="quick-link-card"><strong>Bad inboxes</strong><span>Review bounced or blocked emails.</span></Link>
        <Link href="https://mail.google.com" className="quick-link-card"><strong>Open Gmail</strong><span>Read and answer new replies in Gmail during send-only verification.</span></Link>
      </div>
      <RepliesClient workspace={workspace} replySyncEnabled={featureFlags.gmailReplySync} />
    </div>
  );
}
