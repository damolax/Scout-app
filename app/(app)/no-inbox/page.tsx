import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function NoInboxPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const supabase = await createClient();
  const { data, error: listError } = await supabase
    .from('businesses')
    .select('id,name,email,website,domain,status,updated_at')
    .eq('workspace_id', workspace.id)
    .in('status', ['no_inbox', 'bounced', 'invalid'])
    .order('updated_at', { ascending: false })
    .limit(200);
  return (
    <div className="stack">
      <div className="page-title"><h2>No Inbox</h2><p>Invalid recipients, bounces, and mailer-daemon outcomes. Safe to clean later.</p></div>
      {listError ? <div className="error">{listError.message}</div> : null}
      <div className="card" style={{ padding: 18 }}><div className="table-wrap"><table><thead><tr><th>Business</th><th>Email</th><th>Website</th><th>Status</th><th>Updated</th></tr></thead><tbody>
        {(data || []).map((b) => <tr key={b.id}><td>{b.name || '-'}</td><td>{b.email || '-'}</td><td>{b.website || b.domain || '-'}</td><td className={`status ${b.status}`}>{b.status}</td><td>{new Date(b.updated_at).toLocaleString()}</td></tr>)}
        {!data?.length ? <tr><td colSpan={5} className="muted">No no-inbox records.</td></tr> : null}
      </tbody></table></div></div>
    </div>
  );
}
