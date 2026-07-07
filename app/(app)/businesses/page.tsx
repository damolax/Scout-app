import BusinessQueueClient from './BusinessQueueClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function BusinessesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">{error || 'No workspace found.'}</div>;
  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Businesses</h2>
          <p>Native cloud queue. Search, filter, update statuses, export, and manage imported businesses without rendering the full list at once.</p>
        </div>
      </div>
      <BusinessQueueClient workspace={workspace} />
    </div>
  );
}
