import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function RepliesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const supabase = await createClient();
  const { data, error: listError } = await supabase
    .from('reply_history')
    .select('id,from_email,subject,snippet,received_at,is_real_reply,classification')
    .eq('workspace_id', workspace.id)
    .eq('is_real_reply', true)
    .order('received_at', { ascending: false })
    .limit(100);

  return (
    <div className="stack">
      <div className="page-title"><h2>Replies</h2><p>Real prospect replies only. Bounces and mailer-daemon messages should go to No Inbox.</p></div>
      {listError ? <div className="error">{listError.message}</div> : null}
      <div className="card" style={{ padding: 18 }}>
        <div className="table-wrap"><table><thead><tr><th>From</th><th>Subject</th><th>Snippet</th><th>Received</th><th>Class</th></tr></thead><tbody>
          {(data || []).map((r) => <tr key={r.id}><td>{r.from_email}</td><td>{r.subject}</td><td>{r.snippet}</td><td>{r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</td><td>{r.classification || '-'}</td></tr>)}
          {!data?.length ? <tr><td colSpan={5} className="muted">No real replies yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
