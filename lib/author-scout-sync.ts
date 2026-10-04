import { createAdminClient } from '@/lib/supabase-admin';
import { authorScoutRequest } from '@/lib/author-scout-bridge';
import { cleanText, displayDomain, makeNormalizedKey, normalizeEmail, normalizeWebsite } from '@/lib/normalize';
import { randomUUID } from 'node:crypto';

type AnyRow = Record<string, any>;

async function workspaceIdentity(workspaceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('workspaces').select('id,name').eq('id', workspaceId).single();
  if (error || !data) throw new Error(error?.message || 'Workspace not found.');
  return data;
}

export async function syncAuthorResults(workspaceId: string, userId: string | null | undefined, results: AnyRow[]) {
  if (!results?.length) return { inserted: 0, emails: 0 };
  const supabase = createAdminClient();
  const payload = results.map((row) => {
    const email = normalizeEmail(row.email);
    const website = normalizeWebsite(row.website);
    const name = cleanText(row.name);
    const normalizedKey = makeNormalizedKey({ email, website, name: name + ' ' + cleanText(row.country) });
    return {
      workspace_id: workspaceId,
      name: name || null,
      person_name: name || null,
      email: email || null,
      website: website || null,
      domain: displayDomain({ website, email }) || null,
      category: cleanText(row.genre) || 'Author',
      location: cleanText(row.country) || null,
      source: 'author_scout_background',
      prospect_type: 'author',
      status: email ? 'ready' : 'found',
      score: Number(row.discovery_confidence || 0) || null,
      qualification_score: Number(row.discovery_confidence || 0) || null,
      normalized_key: normalizedKey || ('author:' + String(row.id || randomUUID())),
      raw: {
        authorScout: true,
        authorScoutProspectId: row.id || null,
        genre: row.genre || null,
        country: row.country || null,
        verificationStatus: row.verification_status || null,
        emailSourceUrl: row.email_source_url || null,
        discoveryPlatform: row.discovery_platform || null,
        discoverySourceType: row.discovery_source_type || null,
        discoverySourceUrl: row.discovery_source_url || null,
        discoveryQuery: row.discovery_query || null,
        discoveryEvidence: row.discovery_evidence || null,
        recentActivity: row.recent_activity || null,
        bio: row.bio || null,
        books: row.books || null,
        claimedAt: row.claimed_at || null,
      },
      created_by: userId || null,
      updated_at: new Date().toISOString(),
    };
  }).filter((row) => row.normalized_key);

  const { data, error } = await supabase
    .from('businesses')
    .upsert(payload, { onConflict: 'workspace_id,normalized_key', ignoreDuplicates: false })
    .select('id,email');
  if (error) throw error;

  return {
    inserted: data?.length || 0,
    emails: (data || []).filter((row: AnyRow) => Boolean(row.email)).length,
  };
}

function mapAuthorJobStatus(value: unknown) {
  const status = String(value || '').toLowerCase();
  if (['complete','completed','done','finished'].includes(status)) return 'completed';
  if (['failed','error'].includes(status)) return 'failed';
  if (['cancelled','canceled','stopped'].includes(status)) return 'cancelled';
  if (['paused'].includes(status)) return 'paused';
  if (['queued','starting'].includes(status)) return 'queued';
  return 'running';
}

export async function syncAuthorScoutRun(run: AnyRow) {
  const workspaceId = String(run.workspace_id || '');
  const raw = run.raw && typeof run.raw === 'object' ? run.raw : {};
  const jobId = String(raw.author_job_id || '');
  if (!workspaceId || !jobId) throw new Error('Author Scout run is missing its workspace or Author Scout job id.');

  const workspace = await workspaceIdentity(workspaceId);
  const detail = await authorScoutRequest(workspace, '/api/v1/research/jobs/' + encodeURIComponent(jobId));
  const results = Array.isArray(detail.results) ? detail.results : [];
  const synced = await syncAuthorResults(workspaceId, run.requested_by || null, results);
  const job = detail.job || detail;
  const status = mapAuthorJobStatus(job.status);
  const now = new Date().toISOString();

  const supabase = createAdminClient();
  const { error } = await supabase.from('scout_runs').update({
    status,
    discovered_count: Number(job.raw_results || job.candidates || job.checked || run.discovered_count || 0),
    checked_count: Number(job.checked || run.checked_count || 0),
    qualified_count: Number(job.accepted || results.length || run.qualified_count || 0),
    email_count: results.filter((row: AnyRow) => Boolean(row.email)).length,
    duplicate_count: Number(job.duplicates || run.duplicate_count || 0),
    progress_text: String(job.progress_text || (status === 'completed' ? 'Author Scout completed.' : 'Author Scout is running.')).slice(0, 600),
    completed_at: ['completed','failed','cancelled'].includes(status) ? (run.completed_at || now) : null,
    raw: {
      ...raw,
      author_job_status: job.status || null,
      last_author_sync_at: now,
      synced_result_count: results.length,
    },
    updated_at: now,
  }).eq('workspace_id', workspaceId).eq('id', run.id);
  if (error) throw error;

  return {
    runId: run.id,
    authorJobId: jobId,
    status,
    synced: synced.inserted,
    emails: synced.emails,
  };
}
