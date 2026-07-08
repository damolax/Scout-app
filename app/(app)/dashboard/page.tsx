import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

async function countRows(table: string, workspaceId: string, filter?: { column: string; value: unknown }) {
  const supabase = await createClient();
  let query = supabase.from(table).select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (filter) query = query.eq(filter.column, filter.value);
  const { count } = await query;
  return count || 0;
}

async function safeCount(table: string, workspaceId: string, filter?: { column: string; value: unknown }) {
  try { return await countRows(table, workspaceId, filter); } catch { return 0; }
}

export default async function DashboardPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const supabase = await createClient();

  const [businesses, pending, ready, contacted, responded, realReplies, noInbox, sent, templates, schedules] = await Promise.all([
    safeCount('businesses', workspace.id),
    safeCount('businesses', workspace.id, { column: 'status', value: 'pending' }),
    safeCount('businesses', workspace.id, { column: 'status', value: 'ready' }),
    safeCount('businesses', workspace.id, { column: 'status', value: 'contacted' }),
    safeCount('businesses', workspace.id, { column: 'status', value: 'responded' }),
    safeCount('reply_history', workspace.id, { column: 'is_real_reply', value: 'true' }),
    safeCount('businesses', workspace.id, { column: 'status', value: 'no_inbox' }),
    safeCount('sent_messages', workspace.id, { column: 'status', value: 'sent' }),
    safeCount('templates', workspace.id),
    safeCount('message_schedules', workspace.id, { column: 'status', value: 'scheduled' })
  ]);

  let dueFollowups = 0;
  try {
    const { data } = await supabase.rpc('get_due_followups', { target_workspace: workspace.id, limit_rows: 5000 });
    dueFollowups = (data || []).length;
  } catch {}

  let templateRows: any[] = [];
  let senderRows: any[] = [];
  let scheduleRows: any[] = [];
  try {
    const { data } = await supabase.from('template_response_performance').select('*').eq('workspace_id', workspace.id).order('sent_count', { ascending: false }).limit(10);
    templateRows = data || [];
  } catch {}
  try {
    const { data } = await supabase.from('sender_response_performance').select('*').eq('workspace_id', workspace.id).order('sent_count', { ascending: false }).limit(10);
    senderRows = data || [];
  } catch {}
  try {
    const { data } = await supabase.from('message_schedules').select('id,type,status,target_count,scheduled_for,raw').eq('workspace_id', workspace.id).in('status', ['scheduled','due','running']).order('scheduled_for', { ascending: true }).limit(8);
    scheduleRows = data || [];
  } catch {}

  const responseRate = sent ? `${((realReplies / sent) * 100).toFixed(1)}%` : '0%';
  const emailsPerReply = realReplies ? (sent / realReplies).toFixed(1) : '-';

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Dashboard</h2>
          <p>Queue, sending, follow-ups, and template performance.</p>
        </div>
        <span className="badge">Workspace: {workspace.name}</span>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Businesses</div><div className="num">{businesses.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Pending</div><div className="num">{pending.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Ready To Message</div><div className="num">{ready.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Contacted</div><div className="num">{contacted.toLocaleString()}</div></div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Sent</div><div className="num">{sent.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{realReplies.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Response Rate</div><div className="num">{responseRate}</div></div>
        <div className="card kpi"><div className="title">Emails / Reply</div><div className="num">{emailsPerReply}</div></div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Due Follow-ups</div><div className="num">{dueFollowups.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Scheduled</div><div className="num">{schedules.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">No Inbox</div><div className="num">{noInbox.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Templates</div><div className="num">{templates.toLocaleString()}</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Template Performance</h3>
          <div className="table-wrap"><table><thead><tr><th>Template</th><th>Sent</th><th>Real Replies</th><th>Emails / Reply</th></tr></thead><tbody>
            {(templateRows || []).map((row: any) => <tr key={row.template_id}><td>{row.template_name}</td><td>{Number(row.sent_count || 0).toLocaleString()}</td><td>{Number(row.real_reply_count || 0).toLocaleString()}</td><td>{row.emails_per_reply || '-'}</td></tr>)}
            {!(templateRows || []).length ? <tr><td colSpan={4} className="muted">No template performance yet.</td></tr> : null}
          </tbody></table></div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Sender Performance</h3>
          <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Sent</th><th>Real Replies</th><th>Emails / Reply</th></tr></thead><tbody>
            {(senderRows || []).map((row: any) => <tr key={row.gmail_account_id}><td>{row.sender_email}</td><td>{Number(row.sent_count || 0).toLocaleString()}</td><td>{Number(row.real_reply_count || 0).toLocaleString()}</td><td>{row.emails_per_reply || '-'}</td></tr>)}
            {!(senderRows || []).length ? <tr><td colSpan={4} className="muted">No sender performance yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Upcoming Message Schedules</h3>
        <div className="table-wrap"><table><thead><tr><th>Type</th><th>Date</th><th>Count</th><th>Status</th></tr></thead><tbody>
          {(scheduleRows || []).map((row: any) => <tr key={row.id}><td>{row.type}</td><td>{new Date(row.scheduled_for).toLocaleString()}</td><td>{Number(row.target_count || 0).toLocaleString()}</td><td>{row.status}</td></tr>)}
          {!(scheduleRows || []).length ? <tr><td colSpan={4} className="muted">No scheduled messages yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
