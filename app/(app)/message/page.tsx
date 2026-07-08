import { getCurrentWorkspace } from '@/lib/workspace';
import EmailScoutClient from '../email-scout/EmailScoutClient';

export default async function MessagePage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Message</h2>
        <p>Library, sender rotation, ready contacts, scheduled batches, and 72-hour follow-ups.</p>
      </div>
      <EmailScoutClient workspace={workspace} />
    </div>
  );
}
