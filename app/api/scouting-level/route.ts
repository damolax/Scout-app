export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { fetchUnifiedReplyMetrics } from '@/lib/reply-metrics';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';

const STAGES = [
  { name: 'Novice', min: 0 },
  { name: 'Rookie', min: 1_000 },
  { name: 'Apprentice', min: 12_000 },
  { name: 'Scout', min: 35_000 },
  { name: 'Pro Scout', min: 100_000 },
  { name: 'Strategist', min: 300_000 },
  { name: 'Operator', min: 900_000 },
  { name: 'Rainmaker', min: 2_500_000 },
  { name: 'Commander', min: 7_000_000 },
  { name: 'Master Scout', min: 18_000_000 },
  { name: 'Grandmaster', min: 50_000_000 },
  { name: 'Ultimate', min: 150_000_000 }
];

type CountResult = { ok: boolean; count: number; error?: string };

async function countResult(supabase: any, table: string, workspaceId: string, build?: (query: any) => any): Promise<CountResult> {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    if (build) query = build(query);
    const { count, error } = await query;
    if (error) return { ok: false, count: 0, error: error.message || String(error) };
    return { ok: true, count: Number(count || 0) };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function stageFor(points: number) {
  let currentIndex = 0;
  for (let i = 0; i < STAGES.length; i += 1) if (points >= STAGES[i].min) currentIndex = i;
  const current = STAGES[currentIndex];
  const next = STAGES[currentIndex + 1] || null;
  const progress = next ? Math.max(0, Math.min(100, Math.round(((points - current.min) / (next.min - current.min)) * 100))) : 100;
  return { current, next, progress, stageNumber: currentIndex + 1, totalStages: STAGES.length };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
  if (!workspaceId) return NextResponse.json({ success: false, error: 'workspaceId is required.' }, { status: 400 });
  try {
    await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();

    const { data: existingState, error: stateError } = await supabase
      .from('scouting_xp_state')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (stateError && !String(stateError.message || '').toLowerCase().includes('does not exist')) throw stateError;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const countPromises = [
      countResult(supabase, 'sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered'])),
      countResult(supabase, 'sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered']).gte('sent_at', today.toISOString())),
      countResult(supabase, 'businesses', workspaceId, (q) => q.not('email', 'is', null).neq('email', '').in('status', ['ready', 'found', 'connected'])),
      countResult(supabase, 'email_research_jobs', workspaceId, (q) => q.in('status', ['done', 'found'])),
      countResult(supabase, 'sent_messages', workspaceId, (q) => q.eq('delivery_status', 'manual_reply_sent')),
      countResult(supabase, 'gmail_accounts', workspaceId, (q) => q.or('status.eq.connected,status.eq.active,status.eq.ready,status.is.null')),
      countResult(supabase, 'templates', workspaceId, (q) => q.or('active.eq.true,is_active.eq.true,active.is.null,is_active.is.null')),
      countResult(supabase, 'message_schedules', workspaceId, (q) => q.in('status', ['scheduled', 'due', 'running', 'completed'])),
      countResult(supabase, 'businesses', workspaceId),
    ];
    const [delivered, sentToday, trusted, autoScout, manualReplies, gmailAccounts, templates, schedules, businesses] = await Promise.all(countPromises);
    const dataReliable = [delivered, sentToday, trusted, autoScout, manualReplies, gmailAccounts, templates, schedules, businesses].every((item) => item.ok);

    let replyMetrics = { realReplies: 0 } as any;
    try { replyMetrics = await fetchUnifiedReplyMetrics(supabase, workspaceId); } catch { /* keep last permanent XP */ }

    let points = Number(existingState?.total_xp || 0);
    let baselineCreated = false;
    if (!existingState) {
      if (!dataReliable) {
        return NextResponse.json({ success: false, preservePrevious: true, error: 'Scouting Level data is temporarily unavailable. Scout did not replace the previous level with zero.' }, { status: 503 });
      }
      const baseline = Math.max(0, Math.round(
        delivered.count * 0.25 +
        trusted.count * 0.3 +
        autoScout.count * 0.15 +
        businesses.count * 0.005 +
        Number(replyMetrics.realReplies || 0) * 1500 +
        manualReplies.count * 2000 +
        gmailAccounts.count * 400 +
        templates.count * 60 +
        schedules.count * 20
      ));
      const { data: state, error } = await supabase.from('scouting_xp_state').upsert({
        workspace_id: workspaceId,
        total_xp: baseline,
        baseline_xp: baseline,
        last_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' }).select('*').single();
      if (error) throw error;
      points = Number(state.total_xp || baseline);
      baselineCreated = true;
    }

    return NextResponse.json({
      success: true,
      points,
      permanent: true,
      baselineCreated,
      dataReliable,
      lastConfirmedAt: existingState?.last_confirmed_at || new Date().toISOString(),
      ...stageFor(points),
      stages: STAGES.map((stage, index) => ({ name: stage.name, stageNumber: index + 1, unlocked: points >= stage.min })),
      hints: [
        'Scouting Level is permanent and never decreases.',
        'Clean deliveries, trusted leads, real replies and completed import jobs earn permanent XP.',
        dataReliable ? null : 'Some live performance counts are temporarily unavailable, but your confirmed XP was preserved.'
      ].filter(Boolean),
      highlights: {
        deliveredMessages: delivered.count,
        sentToday: sentToday.count,
        trustedEmails: trusted.count,
        autoScoutJobs: autoScout.count,
        realReplies: Number(replyMetrics.realReplies || 0),
        manualReplies: manualReplies.count,
        gmailAccounts: gmailAccounts.count,
        templates: templates.count,
        schedules: schedules.count,
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, preservePrevious: true, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
