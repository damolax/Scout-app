import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import { featureFlags } from '@/lib/feature-flags';
import OutreachModesClient from './OutreachModesClient';

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ prospect?: string }> }) {
  const query = await searchParams;
  const initialProspectId = String(query?.prospect || '').trim();
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Outreach</h2>
        <p>Send one message at a time after review, or schedule an automatic campaign that continues from the server after you leave.</p>
      </div>
      <div className="quick-links">
        <Link href="/sending-accounts" className="quick-link-card"><strong>Sending Accounts</strong><span>Connect Gmail with an App Password for SMTP sending.</span></Link>
        <Link href="/upload" className="quick-link-card"><strong>Upload Author File</strong><span>Import authors with email, research details, subject and prepared message columns.</span></Link>
        <Link href="/intelligence" className="quick-link-card"><strong>Use Intelligence</strong><span>Build outreach from public evidence.</span></Link>
      </div>
      <OutreachModesClient workspace={workspace} replySyncEnabled={featureFlags.gmailReplySync} initialProspectId={initialProspectId} />
    </div>
  );
}
