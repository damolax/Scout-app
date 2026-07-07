import { getCurrentWorkspace } from '@/lib/workspace';
import EmailScoutClient from './EmailScoutClient';

export default async function EmailScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Email Scout</h2>
        <p>Native outreach engine: templates, sender rotation, fixed batch size, send logs, and performance tracking.</p>
      </div>
      <EmailScoutClient workspace={workspace} />
    </div>
  );
}
