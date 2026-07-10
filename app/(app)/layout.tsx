import { AppNav } from '@/components/AppNav';
import { SignOutButton } from '@/components/SignOutButton';
import { NotificationBell } from '@/components/NotificationBell';
import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { workspace } = await getCurrentWorkspace();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1>Scout</h1>
            <p>{workspace?.name || 'No workspace'}</p>
          </div>
        </div>
        <AppNav />
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <p className="muted" style={{ fontSize: 12, wordBreak: 'break-word' }}>{user?.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="main">
        <div className="main-topbar">
          <div>
            <strong>Scout App</strong>
            <span className="muted"> Simple outreach workspace</span>
          </div>
          <NotificationBell workspaceId={workspace?.id} />
        </div>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
