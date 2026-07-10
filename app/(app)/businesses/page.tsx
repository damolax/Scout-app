import Link from 'next/link';
import BusinessQueueClient from './BusinessQueueClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function BusinessesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">{error || 'No workspace found.'}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Leads</h2>
        <p>CRM queue, duplicate-safe businesses, category filters, details, Auto Scout history, sent messages, and replies.</p>
      </div>
      <div className="quick-links">
        <Link href="/data-safety" className="quick-link-card"><strong>Data safety</strong><span>Review duplicates, repeated emails, and false positives.</span></Link>
        <Link href="/source-scout" className="quick-link-card"><strong>Add more leads</strong><span>Scout, import, or queue new businesses.</span></Link>
      </div>
      <BusinessQueueClient workspace={workspace} />
    </div>
  );
}
