import UploadClient from './UploadClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function UploadPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Upload Lists</h2>
        <p>Import CSV businesses, skip duplicates, and save the queue in Supabase.</p>
      </div>
      <UploadClient workspace={workspace} />
    </div>
  );
}
