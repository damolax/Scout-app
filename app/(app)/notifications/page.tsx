import NotificationsClient from './NotificationsClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return <div className="card"><h2>No workspace</h2><p className="muted">Ask an admin to approve your workspace access.</p></div>;
  return <NotificationsClient workspace={workspace} />;
}
