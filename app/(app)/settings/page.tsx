import SettingsClient from './SettingsClient';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function SettingsPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Settings</h2><p>Backend, extension key, and cloud templates.</p></div>
      <SettingsClient workspace={workspace} />
    </div>
  );
}
