import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import MessageClient from './MessageClient';

export default async function MessagePage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Outreach</h2>
        <p>Templates, category targeting, sending, schedules, follow-ups, and deliverability controls.</p>
      </div>
      <div className="quick-links">
        <Link href="/templates" className="quick-link-card"><strong>Templates</strong><span>Create initial, follow-up, and reply-only templates.</span></Link>
        <Link href="/deliverability" className="quick-link-card"><strong>Deliverability</strong><span>Review sender limits, bounces, and safety checks.</span></Link>
        <Link href="/operations" className="quick-link-card"><strong>Run automation</strong><span>Process scheduled sends and follow-ups.</span></Link>
      </div>
      <MessageClient workspace={workspace} />
    </div>
  );
}
