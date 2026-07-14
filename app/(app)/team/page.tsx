import { createClient } from '@/lib/supabase-server';
import { isScoutAdminEmail } from '@/lib/admin';

type TeamAccountRow = {
  user_id: string | null;
  user_email: string | null;
  workspace_id: string;
  workspace_name: string | null;
  lifetime_sent: number | null;
  connected_senders: number | null;
  total_leads: number | null;
  ready_leads: number | null;
  real_replies: number | null;
  created_at: string | null;
};

type TeamSenderRow = {
  user_email: string | null;
  workspace_id: string;
  workspace_name: string | null;
  sender_email: string | null;
  lifetime_sent: number | null;
  last_sent_at: string | null;
};

function n(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default async function TeamDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isScoutAdminEmail(user?.email)) {
    return <div className="error">Only the main Scout admin can open Team Dashboard.</div>;
  }

  const { data: accountRows, error: accountError } = await supabase.rpc('admin_team_dashboard');
  const { data: senderRows, error: senderError } = await supabase.rpc('admin_team_sender_dashboard');

  if (accountError || senderError) {
    return (
      <div className="stack">
        <div className="page-title"><h2>Team Dashboard</h2><p>Team sending and account totals for the main admin.</p></div>
        <div className="error">Team Dashboard SQL is not ready yet. Run <strong>SUPABASE_V10_30_TEAM_DUPLICATE_GUARD_ADMIN_DASHBOARD.sql</strong>.</div>
        {accountError ? <div className="error">Account totals: {accountError.message}</div> : null}
        {senderError ? <div className="error">Sender totals: {senderError.message}</div> : null}
      </div>
    );
  }

  const accounts = (accountRows || []) as TeamAccountRow[];
  const senders = (senderRows || []) as TeamSenderRow[];
  const totalSent = accounts.reduce((sum, row) => sum + Number(row.lifetime_sent || 0), 0);
  const totalLeads = accounts.reduce((sum, row) => sum + Number(row.total_leads || 0), 0);
  const totalReplies = accounts.reduce((sum, row) => sum + Number(row.real_replies || 0), 0);

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Team Dashboard</h2>
          <p>Admin-only view. See what each private account has sent in its lifetime without exposing their lead lists inside your main dashboard.</p>
        </div>
        <span className="badge">Admin only</span>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Team Accounts</div><div className="num">{n(accounts.length)}</div></div>
        <div className="card kpi"><div className="title">Lifetime Sent</div><div className="num">{n(totalSent)}</div></div>
        <div className="card kpi"><div className="title">Team Leads</div><div className="num">{n(totalLeads)}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{n(totalReplies)}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Account lifetime totals</h3>
        <p className="muted">Each user starts from scratch in their own private workspace, but you can still see lifetime totals here.</p>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Workspace</th><th>Lifetime Sent</th><th>Senders</th><th>Total Leads</th><th>Ready Leads</th><th>Real Replies</th><th>Created</th></tr></thead><tbody>
          {accounts.map((row) => <tr key={row.workspace_id}><td>{row.user_email || '-'}</td><td>{row.workspace_name || row.workspace_id}</td><td>{n(row.lifetime_sent)}</td><td>{n(row.connected_senders)}</td><td>{n(row.total_leads)}</td><td>{n(row.ready_leads)}</td><td>{n(row.real_replies)}</td><td>{row.created_at ? new Date(row.created_at).toLocaleDateString() : '-'}</td></tr>)}
          {!accounts.length ? <tr><td colSpan={8} className="muted">No team accounts yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Gmail sender lifetime totals</h3>
        <p className="muted">This is the exact “how many each account has sent in lifetime” view.</p>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Sender Gmail</th><th>Workspace</th><th>Lifetime Sent</th><th>Last Sent</th></tr></thead><tbody>
          {senders.map((row, index) => <tr key={`${row.workspace_id}-${row.sender_email || index}`}><td>{row.user_email || '-'}</td><td>{row.sender_email || 'Unknown sender'}</td><td>{row.workspace_name || '-'}</td><td>{n(row.lifetime_sent)}</td><td>{row.last_sent_at ? new Date(row.last_sent_at).toLocaleString() : '-'}</td></tr>)}
          {!senders.length ? <tr><td colSpan={5} className="muted">No sender activity yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
