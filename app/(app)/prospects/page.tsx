import Link from 'next/link';
import { getCurrentWorkspace } from '@/lib/workspace';
import ProspectsClient from './ProspectsClient';

export default async function ProspectsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">{error || 'No workspace found.'}</div>;
  return <div className="stack">
    <div className="page-title">
      <div className="actions" style={{justifyContent:'space-between',alignItems:'flex-start'}}>
        <div><h2>Prospects</h2><p>Every author, store, person and business found by Scout lives here, regardless of how it was discovered.</p></div>
        <Link className="btn secondary" href="/upload">Upload list</Link>
      </div>
    </div>
    <ProspectsClient workspace={workspace} />
  </div>;
}
