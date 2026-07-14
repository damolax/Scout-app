import { createClient } from '@/lib/supabase-server';
import { isScoutAdminEmail } from '@/lib/admin';

type TeamAccountRow = {
  user_id: string;
  full_name: string | null;
  user_email: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  lifetime_sent: number | null;
  connected_senders: number | null;
  total_leads: number | null;
  ready_leads: number | null;
  real_replies: number | null;
  auto_replies: number | null;
  no_inbox_count: number | null;
  created_at: string | null;
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

  const { data, error } = await supabase.rpc('admin_team_dashboard');
  if (error) {
    return (
      <div className="stack">
        <div className="page-title"><h2>Team Dashboard</h2><p>Registered users and team-wide totals.</p></div>
        <div className="error">Team Dashboard could not load: {error.message}</div>
      </div>
    );
  }

  const accounts = (data || []) as TeamAccountRow[];
  const totalSent = accounts.reduce((sum, row) => sum + Number(row.lifetime_sent || 0), 0);
  const totalLeads = accounts.reduce((sum, row) => sum + Number(row.total_leads || 0), 0);
  const totalReplies = accounts.reduce((sum, row) => sum + Number(row.real_replies || 0), 0);
  const totalConnected = accounts.reduce((sum, row) => sum + Number(row.connected_senders || 0), 0);

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Team Dashboard</h2>
          <p>Admin-only view of registered Scout users and aggregate activity.</p>
        </div>
        <span className="badge">Admin only</span>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Registered Users</div><div className="num">{n(accounts.length)}</div></div>
        <div className="card kpi"><div className="title">Connected Accounts</div><div className="num">{n(totalConnected)}</div></div>
        <div className="card kpi"><div className="title">Lifetime Sent</div><div className="num">{n(totalSent)}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{n(totalReplies)}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>User lifetime totals</h3>
        <p className="muted">Connected accounts are shown only as a number. Sender email addresses are not displayed.</p>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Connected Accounts</th><th>Lifetime Sent</th><th>Total Leads</th><th>Ready Leads</th><th>Real Replies</th><th>Auto Replies</th><th>No Inbox</th></tr></thead><tbody>
          {accounts.map((row) => (
            <tr key={row.user_id}>
              <td>{row.full_name || '-'}</td>
              <td>{row.user_email || '-'}</td>
              <td>{row.created_at ? new Date(row.created_at).toLocaleDateString() : '-'}</td>
              <td>{n(row.connected_senders)}</td>
              <td>{n(row.lifetime_sent)}</td>
              <td>{n(row.total_leads)}</td>
              <td>{n(row.ready_leads)}</td>
              <td>{n(row.real_replies)}</td>
              <td>{n(row.auto_replies)}</td>
              <td>{n(row.no_inbox_count)}</td>
            </tr>
          ))}
          {!accounts.length ? <tr><td colSpan={10} className="muted">No registered accounts found.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <strong>Team leads: {n(totalLeads)}</strong>
      </div>
    </div>
  );
}
