import { getCurrentWorkspace } from '@/lib/workspace';
import VerifyClient from './VerifyClient';

export default async function VerifyPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Verify Emails</h2>
        <p>Verify imported contacts against the backend verifier, then move safe contacts to Ready and risky contacts to Review.</p>
      </div>
      <VerifyClient workspace={workspace} />
    </div>
  );
}
