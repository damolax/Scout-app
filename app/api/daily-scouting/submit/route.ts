import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { parseSourceScoutText, type SourceScoutMode } from '@/lib/source-scout';
import { createAppNotification } from '@/lib/notifications';

function errorMessage(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const e = error as { message?: string; code?: string; details?: string; hint?: string };
    return [e.message, e.code ? `Code: ${e.code}` : '', e.details ? `Details: ${e.details}` : '', e.hint ? `Hint: ${e.hint}` : ''].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function clampCount(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100000, Math.floor(n)));
}

function todayIso(value: unknown) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || body.workspace_id || '').trim();
    const scoutDate = todayIso(body.scoutDate || body.scout_date);
    const scoutName = String(body.scoutName || body.scout_name || '').trim();
    const niche = String(body.niche || '').trim();
    const location = String(body.location || '').trim();
    const country = String(body.country || '').trim();
    const sourceMode = String(body.sourceMode || body.source_mode || 'mixed') as SourceScoutMode;
    const audienceCategoryId = String(body.audienceCategoryId || body.categoryId || '').trim() || null;
    const audienceCategoryName = String(body.audienceCategoryName || body.categoryName || body.category || '').trim() || null;
    const notes = String(body.notes || '').trim();
    const rawText = String(body.rawText || body.raw_text || body.text || '').trim();
    const importToQueue = Boolean(body.importToQueue || body.import_to_queue);
    const directEmailsReady = body.directEmailsReady !== false;
    const enqueueWebsiteAutoScout = body.enqueueWebsiteAutoScout !== false;
    const manualScoutedCount = clampCount(body.manualScoutedCount || body.manual_scouted_count);
    const manualDirectEmailCount = clampCount(body.manualDirectEmailCount || body.manual_direct_email_count);
    const manualWebsiteOnlyCount = clampCount(body.manualWebsiteOnlyCount || body.manual_website_only_count);

    if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });
    if (!rawText && !manualScoutedCount && !manualDirectEmailCount && !manualWebsiteOnlyCount) {
      return NextResponse.json({ success: false, error: 'Paste today scouting history or enter a manual count first.' }, { status: 400 });
    }

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved,role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('approved', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return NextResponse.json({ success: false, error: 'You are not approved for this workspace.' }, { status: 403 });

    const parsed = rawText ? parseSourceScoutText({ text: rawText, niche, location, country, sourceMode }) : { leads: [], directEmailCount: 0, websiteOnlyCount: 0, rejected: [], dorks: [] };
    const parsedCount = parsed.leads.length || manualScoutedCount;
    const directEmailCount = parsed.directEmailCount || manualDirectEmailCount;
    const websiteOnlyCount = parsed.websiteOnlyCount || manualWebsiteOnlyCount;

    let importBatchId: string | null = null;
    let inserted: Array<{ id: string; email?: string | null; website?: string | null; normalized_key?: string | null }> = [];
    let queuedAutoScout = 0;

    if (importToQueue && parsed.leads.length) {
      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          workspace_id: workspaceId,
          file_name: `daily-scouting-${scoutDate}-${sourceMode}-${new Date().toISOString()}`,
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
      importBatchId = batch.id;

      const payload = parsed.leads.map((lead) => ({
        workspace_id: workspaceId,
        import_batch_id: importBatchId,
        name: lead.name || null,
        email: lead.email || null,
        phone: lead.phone || null,
        website: lead.website || null,
        domain: lead.domain || null,
        category: audienceCategoryName || lead.category || null,
        category_id: audienceCategoryId,
        category_name: audienceCategoryName || lead.category || null,
        location: lead.location || null,
        source: `daily_scouting_${sourceMode}`,
        status: lead.email && directEmailsReady ? 'ready' : 'pending',
        score: lead.email ? Math.max(70, lead.confidence) : null,
        normalized_key: lead.normalized_key,
        raw: { ...(lead.raw || {}), dailyScouting: true, scoutDate },
        created_by: user.id
      }));

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
        const emailPayload = directEmailRows.map((row) => ({
          workspace_id: workspaceId,
          business_id: row.id,
          email: row.email,
          source: `daily_scouting_${sourceMode}`,
          score: 78,
          status: 'direct_source_candidate',
          raw: { sourceMode, audienceCategoryId, audienceCategoryName, importBatchId, dailyScouting: true, scoutDate }
        }));
        const { error } = await supabase
          .from('email_candidates')
          .upsert(emailPayload, { onConflict: 'workspace_id,business_id,email', ignoreDuplicates: true });
        if (error) throw error;
      }

      if (enqueueWebsiteAutoScout) {
        const websiteRows = inserted.filter((row) => !row.email && row.website);
        if (websiteRows.length) {
          const jobPayload = websiteRows.map((row) => ({
            workspace_id: workspaceId,
            business_id: row.id,
            status: 'queued',
            attempts: 0,
            priority: 115,
            requested_by: user.id
          }));
          const { data: jobs, error } = await supabase
            .from('email_research_jobs')
            .upsert(jobPayload, { onConflict: 'workspace_id,business_id', ignoreDuplicates: true })
            .select('id');
          if (error) throw error;
          queuedAutoScout = jobs?.length || 0;
        }
      }

      await supabase
        .from('import_batches')
        .update({ inserted_count: inserted.length, skipped_count: Math.max(0, parsed.leads.length - inserted.length) })
        .eq('id', importBatchId);
    }

    const { data: submission, error: submitError } = await supabase
      .from('daily_scouting_submissions')
      .insert({
        workspace_id: workspaceId,
        scout_date: scoutDate,
        submitted_by: user.id,
        submitter_email: user.email || null,
        scout_name: scoutName || user.email || 'Scout team member',
        niche: niche || null,
        location: location || null,
        country: country || null,
        category_id: audienceCategoryId,
        category_name: audienceCategoryName,
        source_mode: sourceMode,
        notes: notes || null,
        raw_text: rawText || null,
        parsed_count: parsedCount,
        inserted_count: inserted.length,
        skipped_count: importToQueue ? Math.max(0, parsed.leads.length - inserted.length) : 0,
        direct_email_count: directEmailCount,
        website_only_count: websiteOnlyCount,
        queued_auto_scout_count: queuedAutoScout,
        import_batch_id: importBatchId,
        status: importToQueue ? 'submitted_and_imported' : 'submitted',
        raw: {
          audienceCategoryId,
          audienceCategoryName,
          importedToQueue: importToQueue,
          manualCounts: { manualScoutedCount, manualDirectEmailCount, manualWebsiteOnlyCount },
          rejected: parsed.rejected?.slice(0, 25) || [],
          sample: parsed.leads?.slice(0, 20) || []
        }
      })
      .select('id')
      .single();
    if (submitError) throw submitError;

    await supabase.from('activity_logs').insert({
      workspace_id: workspaceId,
      type: 'daily_scouting_submission',
      message: `${scoutName || user.email || 'A team member'} submitted ${parsedCount.toLocaleString()} scouted lead(s) for ${scoutDate}.`,
      raw: { submissionId: submission.id, scoutDate, sourceMode, audienceCategoryId, audienceCategoryName, parsedCount, inserted: inserted.length, directEmailCount, websiteOnlyCount, queuedAutoScout },
      created_by: user.id
    });

    await createAppNotification(supabase as any, {
      workspaceId,
      userId: user.id,
      type: 'daily_scouting_submission',
      title: 'Daily scouting submitted',
      message: `${scoutName || user.email || 'Team member'} submitted ${parsedCount.toLocaleString()} lead(s). Imported ${inserted.length.toLocaleString()} into the queue.`,
      entityType: 'daily_scouting_submission',
      entityId: submission.id,
      raw: { scoutDate, audienceCategoryId, audienceCategoryName, parsedCount, inserted: inserted.length, queuedAutoScout }
    });

    return NextResponse.json({
      success: true,
      submissionId: submission.id,
      scoutDate,
      audienceCategoryId,
      audienceCategoryName,
      parsed: parsed.leads.length,
      counted: parsedCount,
      inserted: inserted.length,
      skippedOrDuplicate: importToQueue ? Math.max(0, parsed.leads.length - inserted.length) : 0,
      directEmails: directEmailCount,
      websiteOnly: websiteOnlyCount,
      queuedAutoScout,
      rejected: parsed.rejected?.slice(0, 25) || [],
      sample: parsed.leads?.slice(0, 50) || []
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error), raw: error }, { status: 500 });
  }
}
