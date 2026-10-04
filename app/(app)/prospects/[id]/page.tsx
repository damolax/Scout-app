import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';
import ProspectDetailClient from './ProspectDetailClient';

export const dynamic = 'force-dynamic';

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;

  const supabase = await createClient();
  const { data: prospect, error: prospectError } = await supabase
    .from('businesses')
    .select('*')
    .eq('workspace_id', workspace.id)
    .eq('id', id)
    .maybeSingle();

  if (prospectError) return <div className="error">{prospectError.message}</div>;
  if (!prospect) return <div className="error">Prospect not found.</div>;

  const [scans, events, sent, candidates, researchJobs] = await Promise.all([
    supabase.from('opportunity_scans')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('business_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('outreach_events')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('business_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('sent_messages')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('business_id', id)
      .order('sent_at', { ascending: false })
      .limit(30),
    supabase.from('email_candidates')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('business_id', id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('email_research_jobs')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('business_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return <ProspectDetailClient
    workspaceId={workspace.id}
    prospect={prospect as any}
    scans={(scans.data || []) as any[]}
    events={(events.data || []) as any[]}
    sent={(sent.data || []) as any[]}
    candidates={(candidates.data || []) as any[]}
    researchJobs={(researchJobs.data || []) as any[]}
  />;
}
