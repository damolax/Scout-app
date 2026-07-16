import { createClient } from '@/lib/supabase-server';
import { isScoutAdminEmail } from '@/lib/admin';
import TeamClient, { TeamAccountRow, TeamSummary } from './TeamClient';

function n(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default async function TeamDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isScoutAdminEmail(user?.email)) {
    return <div className="error">Only the main Scout admin can open Team Dashboard.</div>;
  }

  const [{ data: summaryData, error: summaryError }, { data: pageData, error: pageError }] = await Promise.all([
    supabase.rpc('admin_team_dashboard_summary'),
    supabase.rpc('admin_team_dashboard_page', { p_search: '', p_sort: 'newest', p_page: 1, p_page_size: 20 }),
  ]);
  const error = summaryError || pageError;
  if (error) {
    return (
      <div className="stack">
        <div className="page-title"><h2>Team Dashboard</h2><p>Registered users and team-wide totals.</p></div>
        <div className="error">Team Dashboard could not load: {error.message}. Run the v10.35 SQL migration first.</div>
      </div>
    );
  }

  const summary = ((summaryData || [])[0] || {}) as TeamSummary;
  const accounts = (pageData || []) as TeamAccountRow[];
  const initialMatchingCount = Number(accounts[0]?.matching_count ?? summary.registered_users ?? 0);

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
        <div className="card kpi"><div className="title">Registered Users</div><div className="num">{n(summary.registered_users)}</div></div>
        <div className="card kpi"><div className="title">Connected Accounts</div><div className="num">{n(summary.connected_accounts)}</div></div>
        <div className="card kpi"><div className="title">Lifetime Sent</div><div className="num">{n(summary.lifetime_sent)}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{n(summary.real_replies)}</div></div>
      </div>

      <TeamClient initialAccounts={accounts} initialMatchingCount={initialMatchingCount} />

      <div className="card" style={{ padding: 18 }}>
        <strong>Team leads: {n(summary.total_leads)}</strong>
      </div>
    </div>
  );
}
