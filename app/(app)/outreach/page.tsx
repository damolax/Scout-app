import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import { featureFlags } from '@/lib/feature-flags';
import MessageClient from '../message/MessageClient';

export default async function OutreachPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Outreach</h2>
        <p>Prepare campaigns, rotate authorized senders, schedule messages, and let Scout's server-side worker continue after you close the browser.</p>
      </div>
      <div className="quick-links">
        <Link href="/sending-accounts" className="quick-link-card"><strong>Sending Accounts</strong><span>Connect Gmail with an App Password for automatic SMTP sending.</span></Link>
        <Link href="/templates" className="quick-link-card"><strong>Templates</strong><span>Create first-touch and follow-up messages.</span></Link>
        <Link href="/intelligence" className="quick-link-card"><strong>Use Intelligence</strong><span>Build outreach from public evidence.</span></Link>
      </div>
      <MessageClient workspace={workspace} replySyncEnabled={featureFlags.gmailReplySync} />
    </div>
  );
}
