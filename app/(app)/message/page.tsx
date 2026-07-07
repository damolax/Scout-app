import { getCurrentWorkspace } from '@/lib/workspace';
import EmailScoutClient from '../email-scout/EmailScoutClient';

export default async function MessagePage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Message</h2>
        <p>Send messages to Ready contacts. If nothing is selected, this page pulls the next Ready-to-message contacts from Supabase, not just the preview table.</p>
      </div>
      <EmailScoutClient workspace={workspace} />
    </div>
  );
}
