import Link from 'next/link';
import SettingsClient from './SettingsClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function SettingsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Settings</h2>
        <p>Manage your workspace, sending accounts, extension, limits, and advanced integrations.</p>
      </div>
      <div className="quick-links">
        <Link href="/sending-accounts" className="quick-link-card"><strong>Sending Accounts</strong><span>Preferred: Gmail App Password + SMTP. No Gmail OAuth connection is needed for sending.</span></Link>
        <Link href="/help" className="quick-link-card"><strong>Setup & diagnostics</strong><span>Advanced workspace and worker checks.</span></Link>
      </div>
      <SettingsClient workspace={workspace} />
    </div>
  );
}
