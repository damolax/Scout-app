import { getCurrentWorkspace } from '@/lib/workspace';
import VerifyClient from './VerifyClient';

export default async function VerifyPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Ready Email Detection</h2>
        <p>Fast indexed detection with no paid verifier. The page loads lightweight records, totals refresh separately, and bulk detection saves results with set-based database operations.</p>
      </div>
      <VerifyClient workspace={workspace} />
    </div>
  );
}
