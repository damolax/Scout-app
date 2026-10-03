import { createAdminClient } from '@/lib/supabase-admin';
import { getCurrentWorkspace } from '@/lib/workspace';
import IntelligenceClient from './IntelligenceClient';

export const dynamic = 'force-dynamic';

export default async function IntelligencePage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const supabase = createAdminClient();

  const [{ data: prospects }, { data: scans }] = await Promise.all([
    supabase
      .from('businesses')
      .select('id,name,website,email,location,category,prospect_type,opportunity_score')
      .eq('workspace_id', workspace.id)
      .not('website', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('opportunity_scans')
      .select('id,business_id,website,hostname,prospect_name,industry,opportunity_score,readiness_score,prospect_priority,confidence,status,created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  return (
    <div className="stack">
      <div className="page-title">
        <h2>Opportunity Intelligence</h2>
        <p>Analyze a prospect’s public website, find evidence-backed customer-experience opportunities, and turn those findings into a useful outreach angle.</p>
      </div>
      <IntelligenceClient
        workspaceId={workspace.id}
        prospects={(prospects || []) as any[]}
        recentScans={(scans || []) as any[]}
      />
    </div>
  );
}
