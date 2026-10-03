import Link from 'next/link';
import BusinessQueueClient from '../businesses/BusinessQueueClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function ProspectsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">{error || 'No workspace found.'}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Prospects</h2>
        <p>Authors, stores, businesses and other prospects found by every Scout source live in one workspace.</p>
      </div>
      <div className="quick-links">
        <Link href="/scout" className="quick-link-card"><strong>Scout more prospects</strong><span>Choose a prospect type and search.</span></Link>
        <Link href="/intelligence" className="quick-link-card"><strong>Opportunity Intelligence</strong><span>Analyze a prospect website before outreach.</span></Link>
        <Link href="/verify" className="quick-link-card"><strong>Clean emails</strong><span>Review bad or missing email records.</span></Link>
      </div>
      <BusinessQueueClient workspace={workspace} />
    </div>
  );
}
