import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import SourceScoutClient from './SourceScoutClient';

const quickLinks = [
  { href: '/upload', title: 'Upload CSV', desc: 'Import a list you already have.' },
  { href: '/auto-scout', title: 'Find missing emails', desc: 'Check queued websites for real emails.' },
  { href: '/verify', title: 'Clean emails', desc: 'Mark bad emails or send them back to Auto Scout.' },
  { href: '/businesses', title: 'View leads', desc: 'See ready, contacted, replied and bad-inbox leads.' }
];

export default async function SourceScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Find Leads</h2>
        <p>Use the extension, CSV upload, or Auto Scout to find real business websites and contact emails.</p>
      </div>
      <div className="quick-links">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href} className="quick-link-card">
            <strong>{link.title}</strong>
            <span>{link.desc}</span>
          </Link>
        ))}
      </div>
      <SourceScoutClient workspace={workspace} />
    </div>
  );
}
