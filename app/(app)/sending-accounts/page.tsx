import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import SendingAccountsClient from './SendingAccountsClient';

export default async function SendingAccountsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Sending Accounts</h2>
        <p>Connect Gmail with a Google App Password. Scout can then send scheduled campaigns from the server without Gmail OAuth.</p>
      </div>
      <div className="notice">
        Each Gmail account needs 2-Step Verification and its own App Password. Scout encrypts the App Password before storing it. Google may restrict App Passwords on some managed or protected accounts.
      </div>
      <SendingAccountsClient workspaceId={workspace.id} />
      <div className="actions">
        <Link className="btn secondary" href="/outreach">Open Outreach</Link>
        <Link className="btn secondary" href="/settings">Back to Settings</Link>
      </div>
    </div>
  );
}
