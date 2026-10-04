import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type AnyRow = Record<string, any>;

function typeLabel(value: unknown) {
  const key = String(value || 'business').toLowerCase();
  const labels: Record<string,string> = {
    author: 'Author',
    shopify: 'Shopify',
    website_design: 'Website Design',
    automation: 'Automation',
    planner: 'Planner',
    custom: 'Custom',
    business: 'Business',
  };
  return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusTone(status: unknown) {
  const value = String(status || '').toLowerCase();
  if (['running','completed','ready','contacted'].includes(value)) return 'ok';
  if (['failed','cancelled','invalid','bounced'].includes(value)) return 'bad';
  return '';
}

async function safeCount(supabase: any, table: string, workspaceId: string, modify?: (query: any) => any) {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    if (modify) query = modify(query);
    const { count, error } = await query;
    if (error) throw error;
    return { value: count || 0, error: '' };
  } catch (error) {
    return { value: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function DashboardPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const supabase = createAdminClient();

  const [total, contactable, withEmail, activeScouts, recentProspects, recentScans, activeCampaigns] = await Promise.all([
    safeCount(supabase, 'businesses', workspace.id),
    safeCount(supabase, 'businesses', workspace.id, (q) => q.in('status', ['ready','found']).not('email','is',null).neq('email','')),
    safeCount(supabase, 'businesses', workspace.id, (q) => q.not('email','is',null).neq('email','')),
    supabase.from('scout_runs')
      .select('id,scout_type,status,target_count,discovered_count,checked_count,qualified_count,email_count,duplicate_count,progress_text,created_at,updated_at')
      .eq('workspace_id', workspace.id)
      .in('status', ['queued','running','paused'])
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase.from('businesses')
      .select('id,name,email,website,location,category,status,prospect_type,qualification_score,opportunity_score,created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('opportunity_scans')
      .select('id,business_id,prospect_name,website,opportunity_score,confidence,created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('message_schedules')
      .select('id,type,status,target_count,processed_count,sent_count,failed_count,scheduled_for')
      .eq('workspace_id', workspace.id)
      .in('status', ['scheduled','due','running'])
      .order('scheduled_for', { ascending: true })
      .limit(5),
  ]);

  const scouts = activeScouts.data || [];
  const prospects = recentProspects.data || [];
  const scans = recentScans.data || [];
  const campaigns = activeCampaigns.data || [];
  const migrationIssue = [activeScouts.error, recentProspects.error, recentScans.error].find(Boolean);

  return (
    <div className="stack">
      <div className="page-title">
        <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>{workspace.name || 'Scout'} Home</h2>
            <p>See what Scout is doing now, what it has found, and what should happen next.</p>
          </div>
          <Link className="btn" href="/scout">+ New Scout</Link>
        </div>
      </div>

      {migrationIssue ? <div className="error">
        Unified Scout needs its database migration before every Home widget can load. Apply <strong>database/20261003_UNIFIED_SCOUT_PLATFORM.sql</strong>.
      </div> : null}

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Active Scouts</div><div className="num">{scouts.length.toLocaleString()}</div><div className="muted">Background discovery jobs</div></div>
        <div className="card kpi"><div className="title">Prospects</div><div className="num">{total.value.toLocaleString()}</div><div className="muted">Across every Scout type</div></div>
        <div className="card kpi"><div className="title">Contactable</div><div className="num">{contactable.value.toLocaleString()}</div><div className="muted">Ready/found with email</div></div>
        <div className="card kpi"><div className="title">Emails Found</div><div className="num">{withEmail.value.toLocaleString()}</div><div className="muted">Prospects with an email</div></div>
      </div>

      <div className="grid two">
        <div className="card" style={{ padding: 18 }}>
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <div><h3 style={{ margin: 0 }}>Active Scouts</h3><p className="muted">These continue on server workers.</p></div>
            <Link href="/scout">Open Scout →</Link>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {scouts.map((run: AnyRow) => (
              <div className="card" key={run.id} style={{ padding: 13 }}>
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <div><strong>{typeLabel(run.scout_type)} Scout</strong><div className="muted">{run.progress_text || 'Preparing next cycle…'}</div></div>
                  <span className={'status ' + statusTone(run.status)}>{run.status}</span>
                </div>
                <div className="grid grid-4" style={{ marginTop: 10 }}>
                  <div><strong>{Number(run.discovered_count || 0).toLocaleString()}</strong><div className="muted">Found</div></div>
                  <div><strong>{Number(run.checked_count || 0).toLocaleString()}</strong><div className="muted">Checked</div></div>
                  <div><strong>{Number(run.qualified_count || 0).toLocaleString()}</strong><div className="muted">Saved</div></div>
                  <div><strong>{Number(run.email_count || 0).toLocaleString()}</strong><div className="muted">Emails</div></div>
                </div>
              </div>
            ))}
            {!scouts.length ? <div className="notice">No Scout is running. Start one when you want Scout to keep researching in the background.</div> : null}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <div><h3 style={{ margin: 0 }}>Outreach running</h3><p className="muted">Scheduled and active campaigns.</p></div>
            <Link href="/outreach">Open Outreach →</Link>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {campaigns.map((job: AnyRow) => (
              <div key={job.id} className="card" style={{ padding: 13 }}>
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <strong>{job.type === 'follow_up' ? 'Follow-up campaign' : 'Initial outreach'}</strong>
                  <span className={'status ' + statusTone(job.status)}>{job.status}</span>
                </div>
                <div className="muted" style={{ marginTop: 7 }}>
                  {Number(job.sent_count || 0).toLocaleString()} sent · {Number(job.processed_count || 0).toLocaleString()} processed · target {Number(job.target_count || 0).toLocaleString()}
                </div>
              </div>
            ))}
            {!campaigns.length ? <div className="notice">No automatic campaign is currently scheduled or running.</div> : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div><h3 style={{ margin: 0 }}>Recent prospects</h3><p className="muted">Newest prospects from every discovery source.</p></div>
          <Link href="/prospects">View all →</Link>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Prospect</th><th>Type</th><th>Contact</th><th>Opportunity</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {prospects.map((row: AnyRow) => (
                <tr key={row.id}>
                  <td><strong>{row.name || row.website || row.email || 'Unnamed prospect'}</strong><br /><span className="muted">{row.location || row.category || ''}</span></td>
                  <td><span className="badge">{typeLabel(row.prospect_type)}</span></td>
                  <td>{row.email ? <span>✓ Email found</span> : <span className="muted">Researching</span>}</td>
                  <td>{row.opportunity_score == null ? <span className="muted">Not analyzed</span> : <strong>{row.opportunity_score}/100</strong>}</td>
                  <td><span className={'status ' + statusTone(row.status)}>{row.status}</span></td>
                  <td><Link className="btn secondary" href={'/prospects/' + row.id}>Open</Link></td>
                </tr>
              ))}
              {!prospects.length ? <tr><td colSpan={6} className="muted">No prospects yet. Start a Scout or upload a list.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <Link href="/scout" className="quick-link-card big-action"><strong>Find more prospects</strong><span>Choose Authors, Shopify, Website Design, Automation, Planner or Custom.</span></Link>
        <Link href="/intelligence" className="quick-link-card big-action"><strong>Analyze an opportunity</strong><span>Turn a public website into evidence-backed service opportunities.</span></Link>
      </div>

      {scans.length ? <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Recent Intelligence</h3>
        <div className="stack">
          {scans.map((scan: AnyRow) => <div key={scan.id} className="actions" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div><strong>{scan.prospect_name || scan.website}</strong><div className="muted">{new Date(scan.created_at).toLocaleString()}</div></div>
            <div style={{ textAlign: 'right' }}><strong>{scan.opportunity_score || 0}/100</strong><div className="muted">{scan.confidence || 0}% confidence</div></div>
          </div>)}
        </div>
      </div> : null}
    </div>
  );
}
