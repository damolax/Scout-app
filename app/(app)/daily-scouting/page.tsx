import DailyScoutingClient from './DailyScoutingClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function DailyScoutingPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="card"><h2>No workspace</h2><p className="muted">{error || 'Ask an admin to approve your workspace access.'}</p></div>;
  return <DailyScoutingClient workspace={workspace} />;
}
