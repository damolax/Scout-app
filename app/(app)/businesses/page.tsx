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
          <p>Native cloud CRM queue. Open any business to view details, Auto Scout history, sent messages, and replies.</p>
        </div>
      </div>
      <BusinessQueueClient workspace={workspace} />
    </div>
  );
}
