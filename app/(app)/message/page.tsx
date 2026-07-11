import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import MessageClient from './MessageClient';

export default async function MessagePage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Send Emails</h2>
        <p>Pick an audience, choose a template, then send now or schedule for later.</p>
      </div>
      <div className="quick-links">
        <Link href="/templates" className="quick-link-card"><strong>Templates</strong><span>Write first emails, follow-ups and replies.</span></Link>
        <Link href="/operations" className="quick-link-card"><strong>Worker</strong><span>Run queued sends, follow-ups and Auto Scout.</span></Link>
        <Link href="/deliverability" className="quick-link-card"><strong>Sender safety</strong><span>Check limits, bounces and account health.</span></Link>
      </div>
      <MessageClient workspace={workspace} />
    </div>
  );
}
