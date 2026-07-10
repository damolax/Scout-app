import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import SourceScoutClient from './SourceScoutClient';

const quickLinks = [
  { href: '/upload', title: 'Upload lists', desc: 'Import CSV leads and assign audience categories.' },
  { href: '/daily-scouting', title: 'Daily scouting', desc: 'Team members submit today\'s scouting work.' },
  { href: '/auto-scout', title: 'Auto Scout queue', desc: 'Find missing emails from queued websites.' },
  { href: '/verify', title: 'Verify emails', desc: 'Clean and review email candidates.' }
];

export default async function SourceScoutPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title">
        <h2>Scout & Import</h2>
        <p>Dorking, directory scouting, uploads, daily scouting, and Auto Scout handoff in one place.</p>
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
