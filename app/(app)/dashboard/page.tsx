import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

async function countRows(table: string, workspaceId: string, filter?: { column: string; value: string }) {
  const supabase = await createClient();
  let query = supabase.from(table).select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (filter) query = query.eq(filter.column, filter.value);
  const { count } = await query;
  return count || 0;
}

export default async function DashboardPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;

  const [businesses, pending, ready, contacted, replies, noInbox, history] = await Promise.all([
    countRows('businesses', workspace.id),
    countRows('businesses', workspace.id, { column: 'status', value: 'pending' }),
    countRows('businesses', workspace.id, { column: 'status', value: 'ready' }),
    countRows('businesses', workspace.id, { column: 'status', value: 'contacted' }),
    countRows('reply_history', workspace.id),
    countRows('businesses', workspace.id, { column: 'status', value: 'no_inbox' }),
    countRows('scout_history', workspace.id)
  ]);

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Dashboard</h2>
          <p>Lightweight cloud dashboard. No heavy auto-render loop.</p>
        </div>
        <span className="badge">Workspace: {workspace.name}</span>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Current Businesses</div><div className="num">{businesses}</div></div>
        <div className="card kpi"><div className="title">Pending</div><div className="num">{pending}</div></div>
        <div className="card kpi"><div className="title">Ready</div><div className="num">{ready}</div></div>
        <div className="card kpi"><div className="title">Contacted</div><div className="num">{contacted}</div></div>
      </div>

      <div className="grid grid-3">
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{replies}</div></div>
        <div className="card kpi"><div className="title">No Inbox / Bounced</div><div className="num">{noInbox}</div></div>
        <div className="card kpi"><div className="title">Team Scouted History</div><div className="num">{history}</div></div>
      </div>

      <div className="notice">
        v8 stores the queue and scout history in Supabase, so you can continue on your phone after signing in. The Chrome extension can remain login-free and still export CSVs for this app.
      </div>
    </div>
  );
}
