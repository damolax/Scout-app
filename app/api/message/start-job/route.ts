import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAppNotification } from '@/lib/notifications';
import { businessIdentityKeys } from '@/lib/normalize';
import { ensureMessageWorker } from '@/lib/message-worker';
import { featureFlags } from '@/lib/feature-flags';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

const MAX_MESSAGE_BATCH_SIZE = 50000;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || '').trim();
    if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .limit(1);
    if (memberError) throw memberError;
    if (!member?.length) return NextResponse.json({ success: false, error: 'You do not belong to this workspace.' }, { status: 403 });

    const type = String(body.type || 'initial') === 'follow_up' ? 'follow_up' : 'initial';
    if (type === 'follow_up' && !featureFlags.gmailReplySync) {
      return NextResponse.json({
        success: false,
        disabled: true,
        error: 'Follow-up sending requires Gmail reply synchronization. Reconnect Gmail with reply-reading permission or enable the inbound worker.'
      }, { status: 403 });
    }
    const targetCount = Math.max(1, Math.min(MAX_MESSAGE_BATCH_SIZE, Number(body.targetCount || 1000)));
    let selectedBusinessIds = Array.isArray(body.selectedBusinessIds) ? body.selectedBusinessIds.map(String).filter(Boolean).slice(0, targetCount) : [];
    let teamDuplicatesBlocked = 0;

    if (selectedBusinessIds.length) {
      const { data: selectedRows, error: selectedError } = await supabase
        .from('businesses')
        .select('id,normalized_key,email,domain,website,phone,name')
        .eq('workspace_id', workspaceId)
        .in('id', selectedBusinessIds);
      if (selectedError) throw selectedError;
      const rowKeys = new Map<string, string[]>();
      const allKeys = new Set<string>();
      for (const row of selectedRows || []) {
        const keys = businessIdentityKeys(row as any);
        rowKeys.set(String((row as any).id), keys);
        for (const key of keys) allKeys.add(key);
      }
      const keys = Array.from(allKeys);
      const blockedKeys = new Set<string>();
      for (let index = 0; index < keys.length; index += 1000) {
        const { data: guardRows, error: guardError } = await supabase.rpc('team_duplicate_keys', {
          input_keys: keys.slice(index, index + 1000),
          target_workspace: workspaceId
        });
        if (guardError) throw guardError;
        for (const row of guardRows || []) blockedKeys.add(String((row as any).normalized_key || ''));
      }
      const allowedIds = new Set((selectedRows || [])
        .filter((row: any) => !(rowKeys.get(String(row.id)) || []).some((key) => blockedKeys.has(key)))
        .map((row: any) => String(row.id)));
      teamDuplicatesBlocked = Math.max(0, selectedBusinessIds.length - allowedIds.size);
      selectedBusinessIds = selectedBusinessIds.filter((id: string) => allowedIds.has(id));
      if (!selectedBusinessIds.length) {
        return NextResponse.json({ success: false, code: 'team_duplicate_blocked', error: 'All selected leads are already owned by another Scout user in this deployment.', teamDuplicatesBlocked }, { status: 409 });
      }
    }
    const selectedSenderIds = Array.isArray(body.selectedSenderIds) ? body.selectedSenderIds.map(String).filter(Boolean) : [];
    if (!selectedSenderIds.length) return NextResponse.json({ success: false, error: 'Select at least one connected sender first.' }, { status: 400 });

    const raw = {
      ...(body.raw && typeof body.raw === 'object' ? body.raw : {}),
      durable_job: true,
      created_from: 'message_page_start_job',
      selected_business_ids: selectedBusinessIds,
      selected_sender_ids: selectedSenderIds,
      selected_sender_emails: Array.isArray(body.selectedSenderEmails) ? body.selectedSenderEmails.map(String).filter(Boolean) : [],
      template_mode: body.templateMode || 'specific',
      sender_mode: body.senderMode || 'rotate',
      sender_run_limits: body.senderRunLimits || {},
      business_category_filter: body.businessCategoryFilter || '',
      country_filter: body.locationFilter || body.countryFilter || '',
      location_filter: body.locationFilter || body.countryFilter || '',
      location_filter_mode: body.locationFilter || body.countryFilter ? 'uploaded_list_multi_field' : '',
      audience_category_id: body.audienceCategoryId || null,
      audience_category_name: body.audienceCategoryName || null,
      ready_search: body.readySearch || '',
      dry_run: Boolean(body.dryRun),
      allow_high_risk_send: Boolean(body.allowHighRiskSend),
      followup_segment: type === 'follow_up' ? String(body.followupSegment || 'all_unanswered') : null,
      followup_stage: type === 'follow_up' ? Math.min(2, Math.max(1, Number(body.followupStage || 1))) : null,
      followup_after_hours: type === 'follow_up' ? Math.min(720, Math.max(1, Number(body.followupAfterHours || 72))) : null,
      followup_audience_category_id: type === 'follow_up' ? (body.followupAudienceCategoryId || null) : null,
      followup_country: type === 'follow_up' ? String(body.followupCountry || '') : '',
      missing_translation_action: type === 'follow_up' && ['stop', 'exclude', 'english'].includes(String(body.missingTranslationAction || 'stop'))
        ? String(body.missingTranslationAction || 'stop')
        : 'english',
      due_business_ids: type === 'follow_up' ? selectedBusinessIds : [],
      team_duplicates_blocked_before_job: teamDuplicatesBlocked,
      delay_ms: 0,
      pacing_mode: 'database_random_90_210_seconds',
      parallel_per_sender: true
    };

    const scheduleFor = new Date(body.scheduledFor || Date.now());
    if (Number.isNaN(scheduleFor.getTime())) throw new Error('Invalid scheduledFor value.');

    const { data, error } = await supabase.from('message_schedules').insert({
      workspace_id: workspaceId,
      type,
      category_id: body.categoryId || null,
      audience_category_id: body.audienceCategoryId || null,
      audience_category_name: body.audienceCategoryName || null,
      template_id: body.templateId || null,
      target_count: selectedBusinessIds.length || targetCount,
      scheduled_for: scheduleFor.toISOString(),
      status: 'scheduled',
      run_kind: body.runKind || 'manual_now',
      created_by: user.id,
      followup_segment: type === 'follow_up' ? String(body.followupSegment || 'all_unanswered') : null,
      raw
    }).select('*').single();
    if (error) throw error;

    const workerSetup = await ensureMessageWorker(request.nextUrl.origin);

    const shouldRunNow = body.runNow !== false && scheduleFor.getTime() <= Date.now() + 60_000;
    const workerFailed = !workerSetup.ready;
    const startState = workerFailed ? 'warning' : 'queued';
    const startMessage = workerFailed
      ? `The job was saved, but the central worker needs attention: ${workerSetup.error || 'worker setup is not ready'}`
      : shouldRunNow
        ? 'The job is queued. The central worker will start it automatically within about 30 seconds using the saved sender limits and cooldowns.'
        : `The job is scheduled for ${scheduleFor.toLocaleString()}. The central worker will start it automatically when it becomes due.`;
    const workerKick = {
      success: workerSetup.ready,
      accepted: true,
      mode: 'central_worker',
      synchronousExecution: false,
    };
    const firstSent = 0;
    const firstAttempted = 0;

    try {
      await createAppNotification(supabase as any, {
        workspaceId,
        userId: user.id,
        type: startState === 'warning' ? 'job_warning' : 'job_queued',
        title: startState === 'warning'
          ? `${type === 'follow_up' ? 'Follow-up' : 'Message'} job queued with worker warning`
          : `${type === 'follow_up' ? 'Follow-up' : 'Message'} job queued`,
        message: startMessage,
        entityType: 'message_schedule',
        entityId: data.id,
        raw: {
          schedule_id: data.id,
          type,
          targetCount,
          selectedBusinessCount: selectedBusinessIds.length,
          workerKick,
          workerSetup,
        }
      });
    } catch {}

    return NextResponse.json({
      success: true,
      warning: workerFailed ? startMessage : undefined,
      schedule: data,
      startState,
      startMessage,
      firstSent,
      firstAttempted,
      startedWorker: workerSetup.ready,
      executionMode: 'central_worker',
      workerKick,
      workerSetup,
      teamDuplicatesBlocked,
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
