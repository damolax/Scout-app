import SettingsClient from './SettingsClient';
import { getCurrentWorkspace } from '@/lib/workspace';
import { createClient } from '@/lib/supabase-server';
import { isScoutAdminEmail } from '@/lib/admin';
import { featureFlags } from '@/lib/feature-flags';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  return (
    <div className="stack">
      <div className="page-title"><h2>Settings</h2><p>Backend, extension key, and cloud templates.</p></div>
      <SettingsClient workspace={workspace} isAdmin={isScoutAdminEmail(user?.email)} nativeSignatureSyncEnabled={featureFlags.gmailNativeSignatureSync} placementTestsEnabled={featureFlags.placementTests} />
    </div>
  );
}
