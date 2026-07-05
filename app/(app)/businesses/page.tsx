import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

export default async function BusinessesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = typeof params?.status === 'string' ? params.status : '';
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;

  const supabase = await createClient();
  let query = supabase
    .from('businesses')
    .select('id,name,email,phone,website,domain,category,location,status,score,created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const { data, error: listError } = await query;

  return (
    <div className="stack">
      <div className="topbar">
        <div className="page-title">
          <h2>Businesses</h2>
          <p>Current cloud queue. Showing latest 200 records.</p>
        </div>
        <div className="actions">
          {['pending','ready','contacted','no_inbox'].map((s) => <a key={s} className="btn secondary" href={`/businesses?status=${s}`}>{s}</a>)}
          <a className="btn secondary" href="/businesses">All</a>
        </div>
      </div>
      {listError ? <div className="error">{listError.message}</div> : null}
      <div className="card" style={{ padding: 18 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Email</th><th>Website</th><th>Category</th><th>Location</th><th>Status</th><th>Score</th></tr></thead>
            <tbody>
              {(data || []).map((item) => (
                <tr key={item.id}>
                  <td>{item.name || '-'}</td>
                  <td>{item.email || '-'}</td>
                  <td>{item.website || item.domain || '-'}</td>
                  <td>{item.category || '-'}</td>
                  <td>{item.location || '-'}</td>
                  <td className={`status ${item.status}`}>{item.status}</td>
                  <td>{item.score ?? '-'}</td>
                </tr>
              ))}
              {!data?.length ? <tr><td colSpan={7} className="muted">No businesses found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
