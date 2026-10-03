import { createAdminClient } from '@/lib/supabase-admin';
import { runAutoSourceScout } from '@/lib/source-scout-auto';
import { businessIdentityKeys } from '@/lib/normalize';

type AnyRow = Record<string, any>;

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function prospectType(value: unknown) {
  return String(value || 'business').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40) || 'business';
}

function elapsedMinutes(run: AnyRow) {
  const start = new Date(String(run.started_at || run.created_at || Date.now())).getTime();
  return Number.isFinite(start) ? Math.max(0, (Date.now() - start) / 60000) : 0;
}

export async function processUnifiedScoutRun(run: AnyRow) {
  const supabase = createAdminClient();
  const workspaceId = String(run.workspace_id || '');
  const runId = String(run.id || '');
  const filters = run.filters && typeof run.filters === 'object' ? run.filters : {};
  const raw = run.raw && typeof run.raw === 'object' ? run.raw : {};
  const type = prospectType(run.scout_type);
  const durationMinutes = Math.max(1, Math.min(10080, number(raw.duration_minutes, 30)));
  const targetCount = Math.max(0, number(run.target_count, 0));
  const alreadyQualified = number(run.qualified_count, 0);

  if (!workspaceId || !runId) throw new Error('Scout run is missing its workspace or id.');
  if (['completed','failed','cancelled'].includes(String(run.status || ''))) return { runId, skipped: true, status: run.status };

  if (elapsedMinutes(run) >= durationMinutes || (targetCount > 0 && alreadyQualified >= targetCount)) {
    await supabase.from('scout_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress_text: targetCount > 0 && alreadyQualified >= targetCount
        ? 'Target reached.'
        : 'Background Scout duration completed.',
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('id', runId);
    return { runId, completed: true };
  }

  const now = new Date().toISOString();
  if (String(run.status) === 'queued') {
    await supabase.from('scout_runs').update({
      status: 'running',
      started_at: run.started_at || now,
      progress_text: 'Background Scout is discovering prospects.',
      updated_at: now,
    }).eq('workspace_id', workspaceId).eq('id', runId);
  }

  const cycle = Math.max(0, number(raw.cycle, 0)) + 1;
  const signals = Array.isArray(filters.signals) ? filters.signals : String(filters.signals || '').split(/[\n,]+/).filter(Boolean);
  const rotatingSignals = [
    ...signals,
    cycle % 4 === 0 ? 'owner founder contact' : '',
    cycle % 4 === 1 ? 'official website contact' : '',
    cycle % 4 === 2 ? 'about team email' : '',
    cycle % 4 === 3 ? 'book a call get a quote' : '',
  ].filter(Boolean);

  const auto = await runAutoSourceScout({
    niche: String(filters.niche || ''),
    location: String(filters.location || ''),
    country: String(filters.country || ''),
    sourceMode: 'bing_dork',
    maxPages: Math.max(4, Math.min(10, number(filters.max_pages, 7))),
    maxSearchQueries: Math.max(1, Math.min(5, number(filters.max_search_queries, 3))),
    fetchTimeoutMs: 5500,
    signals: rotatingSignals,
  });

  const parsed = auto.parsed;
  const leadIdentityKeys = new Map<string, string[]>();
  const allIdentityKeys = new Set<string>();
  for (const lead of parsed.leads) {
    const keys = businessIdentityKeys(lead as any);
    leadIdentityKeys.set(lead.normalized_key, keys);
    keys.forEach((key) => allIdentityKeys.add(key));
  }

  const teamDuplicateKeys = new Set<string>();
  const identityKeys = Array.from(allIdentityKeys);
  for (let index = 0; index < identityKeys.length; index += 1000) {
    const { data, error } = await supabase.rpc('team_duplicate_keys', {
      input_keys: identityKeys.slice(index, index + 1000),
      target_workspace: workspaceId,
    });
    if (error) throw error;
    for (const row of data || []) teamDuplicateKeys.add(String((row as AnyRow).normalized_key || ''));
  }

  const candidatePayload = parsed.leads.map((lead) => ({
    workspace_id: workspaceId,
    run_id: runId,
    prospect_type: type,
    candidate_key: lead.normalized_key,
    name: lead.name || null,
    website: lead.website || null,
    email: lead.email || null,
    country: String(filters.country || lead.location || '') || null,
    source_url: lead.website || null,
    status: 'discovered',
    score: lead.confidence || null,
    evidence: { reason: lead.reason, sourceMode: 'background_web_scout' },
    raw: lead.raw || {},
    updated_at: now,
  }));
  if (candidatePayload.length) {
    const { error } = await supabase.from('scout_candidates')
      .upsert(candidatePayload, { onConflict: 'workspace_id,candidate_key', ignoreDuplicates: true });
    if (error) throw error;
  }

  const freshLeads = parsed.leads.filter((lead) => {
    const keys = leadIdentityKeys.get(lead.normalized_key) || [];
    return !keys.some((key) => teamDuplicateKeys.has(key));
  });
  const duplicates = parsed.leads.length - freshLeads.length;

  const businessPayload = freshLeads.map((lead) => ({
    workspace_id: workspaceId,
    name: lead.name || null,
    email: lead.email || null,
    phone: lead.phone || null,
    website: lead.website || null,
    domain: lead.domain || null,
    category: String(filters.category || filters.niche || lead.category || '') || null,
    location: lead.location || String(filters.country || '') || null,
    source: 'unified_background_scout',
    prospect_type: type,
    status: lead.email ? 'ready' : 'pending',
    score: lead.confidence || null,
    qualification_score: lead.confidence || null,
    normalized_key: lead.normalized_key,
    raw: { ...(lead.raw || {}), prospectType: type, scoutRunId: runId, backgroundScout: true },
    created_by: run.requested_by || null,
    updated_at: now,
  }));

  let inserted: AnyRow[] = [];
  if (businessPayload.length) {
    const { data, error } = await supabase.from('businesses')
      .upsert(businessPayload, { onConflict: 'workspace_id,normalized_key', ignoreDuplicates: true })
      .select('id,email,website,normalized_key');
    if (error) throw error;
    inserted = data || [];
  }

  const direct = inserted.filter((row) => row.email);
  if (direct.length) {
    const { error } = await supabase.from('email_candidates').upsert(
      direct.map((row) => ({
        workspace_id: workspaceId,
        business_id: row.id,
        email: row.email,
        source: 'unified_background_scout',
        score: 80,
        status: 'direct_source_candidate',
        raw: { scoutRunId: runId, prospectType: type },
      })),
      { onConflict: 'workspace_id,business_id,email', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const websiteOnly = inserted.filter((row) => !row.email && row.website);
  if (websiteOnly.length) {
    const { error } = await supabase.from('email_research_jobs').upsert(
      websiteOnly.map((row) => ({
        workspace_id: workspaceId,
        business_id: row.id,
        status: 'queued',
        attempts: 0,
        priority: 130,
        requested_by: run.requested_by || null,
      })),
      { onConflict: 'workspace_id,business_id', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const discoveredTotal = number(run.discovered_count, 0) + parsed.leads.length;
  const checkedTotal = number(run.checked_count, 0) + auto.fetchedPages.length;
  const qualifiedTotal = number(run.qualified_count, 0) + inserted.length;
  const emailTotal = number(run.email_count, 0) + direct.length;
  const duplicateTotal = number(run.duplicate_count, 0) + duplicates;
  const shouldFinish = (targetCount > 0 && qualifiedTotal >= targetCount) || elapsedMinutes({ ...run, started_at: run.started_at || now }) >= durationMinutes;

  const { error: updateError } = await supabase.from('scout_runs').update({
    status: shouldFinish ? 'completed' : 'running',
    discovered_count: discoveredTotal,
    checked_count: checkedTotal,
    qualified_count: qualifiedTotal,
    email_count: emailTotal,
    duplicate_count: duplicateTotal,
    progress_text: shouldFinish
      ? 'Background Scout completed.'
      : 'Cycle ' + cycle + ': ' + inserted.length + ' new prospect(s), ' + direct.length + ' email(s), ' + websiteOnly.length + ' queued for email enrichment.',
    completed_at: shouldFinish ? new Date().toISOString() : null,
    raw: { ...raw, cycle, last_cycle_at: now, duration_minutes: durationMinutes, last_errors: auto.errors.slice(0, 10) },
    updated_at: now,
  }).eq('workspace_id', workspaceId).eq('id', runId);
  if (updateError) throw updateError;

  return {
    runId,
    cycle,
    discovered: parsed.leads.length,
    inserted: inserted.length,
    emails: direct.length,
    queuedEmailResearch: websiteOnly.length,
    duplicates,
    completed: shouldFinish,
  };
}

export async function runUnifiedScoutWorker(limit = 1) {
  const supabase = createAdminClient();
  const safeLimit = Math.max(1, Math.min(3, Number(limit || 1)));
  const { data: runs, error } = await supabase.from('scout_runs')
    .select('*')
    .in('status', ['queued','running'])
    .neq('scout_type', 'author')
    .order('updated_at', { ascending: true })
    .limit(safeLimit);
  if (error) throw error;

  const results = [];
  for (const run of runs || []) {
    try {
      results.push(await processUnifiedScoutRun(run));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from('scout_runs').update({
        status: 'running',
        progress_text: 'Scout cycle failed and will retry: ' + message.slice(0, 240),
        raw: { ...(run.raw || {}), last_error: message.slice(0, 1200), last_error_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', run.workspace_id).eq('id', run.id);
      results.push({ runId: run.id, error: message });
    }
  }
  return results;
}
