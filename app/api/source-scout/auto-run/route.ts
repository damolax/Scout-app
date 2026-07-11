import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runAutoSourceScout } from '@/lib/source-scout-auto';
import type { SourceScoutMode } from '@/lib/source-scout';

function errorMessage(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const e = error as { message?: string; code?: string; details?: string; hint?: string };
    return [e.message, e.code ? `Code: ${e.code}` : '', e.details ? `Details: ${e.details}` : '', e.hint ? `Hint: ${e.hint}` : ''].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch { return String(error); }
}

async function assertMember(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, userId: string) {
  const { data: member, error } = await supabase
    .from('workspace_members')
    .select('workspace_id,user_id,approved')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('approved', true)
    .maybeSingle();
  if (error) throw error;
  if (!member) throw new Error('You are not approved for this workspace.');
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || '');
    if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });
    await assertMember(supabase, workspaceId, user.id);

    const sourceMode = String(body.sourceMode || 'bing_dork') as SourceScoutMode;
    const audienceCategoryId = String(body.audienceCategoryId || body.categoryId || '').trim() || null;
    const audienceCategoryName = String(body.audienceCategoryName || body.categoryName || body.category || '').trim() || null;
    const directEmailsReady = body.directEmailsReady !== false;
    const enqueueWebsiteAutoScout = body.enqueueWebsiteAutoScout !== false;
    const maxPages = Math.max(1, Math.min(Number(body.maxPages || 20), 60));
    const maxSearchQueries = Math.max(0, Math.min(Number(body.maxSearchQueries ?? 3), 8));
    const startUrls = String(body.startUrls || '')
      .split(/\n|,|\s+/)
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 25);

    if (!startUrls.length && maxSearchQueries < 1) {
      return NextResponse.json({ success: false, error: 'Add at least one directory/search URL, or allow at least one Bing dork query.' }, { status: 400 });
    }

    const auto = await runAutoSourceScout({
      niche: String(body.niche || ''),
      location: String(body.location || ''),
      country: String(body.country || ''),
      sourceMode,
      startUrls,
      maxPages,
      maxSearchQueries,
      signals: body.scoutSignals || body.signals || ''
    });

    const parsed = auto.parsed;
    const { data: batch, error: batchError } = await supabase
      .from('import_batches')
      .insert({
        workspace_id: workspaceId,
        file_name: `auto-source-scout-${sourceMode}-${new Date().toISOString()}`,
        row_count: parsed.leads.length,
        inserted_count: 0,
        skipped_count: 0,
        headers: ['name', 'email', 'website', 'phone', 'category', 'location', 'source'],
        category_id: audienceCategoryId,
        category_name: audienceCategoryName,
        source_mode: sourceMode,
        created_by: user.id
      })
      .select('id')
      .single();
    if (batchError) throw batchError;

    const payload = parsed.leads.map((lead) => ({
      workspace_id: workspaceId,
      import_batch_id: batch.id,
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || null,
      website: lead.website || null,
      domain: lead.domain || null,
      category: audienceCategoryName || lead.category || null,
      category_id: audienceCategoryId,
      category_name: audienceCategoryName || lead.category || null,
      location: lead.location || null,
      source: `${lead.source}_auto_fetch`,
      status: lead.email && directEmailsReady ? 'ready' : 'pending',
      score: lead.email ? Math.max(72, lead.confidence) : null,
      normalized_key: lead.normalized_key,
      raw: { ...lead.raw, autoFetched: true, sourceTextSample: auto.sourceText.slice(0, 800) },
      created_by: user.id
    }));

    let inserted: Array<{ id: string; email?: string | null; website?: string | null; normalized_key?: string | null }> = [];
    if (payload.length) {
      const { data, error } = await supabase
        .from('businesses')
        .upsert(payload, { onConflict: 'workspace_id,normalized_key', ignoreDuplicates: true })
        .select('id,email,website,normalized_key');
      if (error) throw error;
      inserted = (data || []) as typeof inserted;
    }

    const directEmailRows = inserted.filter((row) => row.email);
    if (directEmailRows.length) {
      const { error } = await supabase
        .from('email_candidates')
        .upsert(directEmailRows.map((row) => ({
          workspace_id: workspaceId,
          business_id: row.id,
          email: row.email,
          source: `auto_source_scout_${sourceMode}`,
          score: 82,
          status: 'direct_source_candidate',
          raw: { sourceMode, audienceCategoryId, audienceCategoryName, importBatchId: batch.id, autoSourceScout: true }
        })), { onConflict: 'workspace_id,business_id,email', ignoreDuplicates: true });
      if (error) throw error;
    }

    let queuedAutoScout = 0;
    if (enqueueWebsiteAutoScout) {
      const websiteRows = inserted.filter((row) => !row.email && row.website);
      if (websiteRows.length) {
        const { data: jobs, error } = await supabase
          .from('email_research_jobs')
          .upsert(websiteRows.map((row) => ({
            workspace_id: workspaceId,
            business_id: row.id,
            status: 'queued',
            attempts: 0,
            priority: 135,
            requested_by: user.id
          })), { onConflict: 'workspace_id,business_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        queuedAutoScout = jobs?.length || 0;
      }
    }

    await supabase
      .from('import_batches')
      .update({ inserted_count: inserted.length, skipped_count: Math.max(0, payload.length - inserted.length) })
      .eq('id', batch.id);

    await supabase.from('activity_logs').insert({
      workspace_id: workspaceId,
      type: 'auto_source_scout',
      message: `Auto Source Scout fetched ${auto.fetchedPages.length} page(s), imported ${inserted.length} lead(s), direct emails ${directEmailRows.length}, queued ${queuedAutoScout} website(s).`,
      raw: { sourceMode, audienceCategoryId, audienceCategoryName, fetchedPages: auto.fetchedPages.slice(0, 40), errors: auto.errors.slice(0, 20), importBatchId: batch.id },
      created_by: user.id
    });

    return NextResponse.json({
      success: true,
      importBatchId: batch.id,
      fetchedPages: auto.fetchedPages.length,
      fetchedSample: auto.fetchedPages.slice(0, 30),
      fetchErrors: auto.errors.slice(0, 20),
      parsed: parsed.leads.length,
      inserted: inserted.length,
      skippedOrDuplicate: Math.max(0, payload.length - inserted.length),
      directEmails: directEmailRows.length,
      websiteOnly: inserted.filter((row) => !row.email && row.website).length,
      queuedAutoScout,
      rejected: parsed.rejected,
      sample: parsed.leads.slice(0, 50),
      sourceTextSample: auto.sourceText.slice(0, 4000)
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error), raw: error }, { status: 500 });
  }
}
