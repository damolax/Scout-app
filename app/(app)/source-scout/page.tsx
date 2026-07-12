import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';

const quickLinks = [
  { href: '/upload', title: 'Upload leads', desc: 'Add a CSV list.' },
  { href: '/auto-scout', title: 'Find missing emails', desc: 'Let Scout check websites.' },
  { href: '/verify', title: 'Clean emails', desc: 'Delete bad emails or redetect.' },
  { href: '/businesses', title: 'View all leads', desc: 'Open your lead list.' }
];

export default async function SourceScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Find Leads</h2>
        <p>Choose what you want to do.</p>
      </div>
      <div className="quick-links">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href} className="quick-link-card">
            <strong>{link.title}</strong>
            <span>{link.desc}</span>
          </Link>
        ))}
      </div>
      <div className="notice">Tip: Upload leads first. Then use Auto Scout to find missing emails. Use Clean emails to delete bad ones.</div>
    </div>
  );
}
