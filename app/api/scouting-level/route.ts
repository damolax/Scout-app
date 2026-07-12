export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

const STAGES = [
  { name: 'Novice', min: 0 },
  { name: 'Rookie', min: 250 },
  { name: 'Apprentice', min: 1_000 },
  { name: 'Scout', min: 3_000 },
  { name: 'Pro Scout', min: 10_000 },
  { name: 'Strategist', min: 30_000 },
  { name: 'Operator', min: 100_000 },
  { name: 'Rainmaker', min: 300_000 },
  { name: 'Commander', min: 900_000 },
  { name: 'Master Scout', min: 2_500_000 },
  { name: 'Grandmaster', min: 8_000_000 },
  { name: 'Ultimate', min: 25_000_000 }
];

async function safeCount(supabase: any, table: string, workspaceId: string, build?: (query: any) => any) {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    if (build) query = build(query);
    const { count } = await query;
    return Number(count || 0);
  } catch {
    return 0;
  }
}

function stageFor(points: number) {
  let currentIndex = 0;
  for (let i = 0; i < STAGES.length; i += 1) {
    if (points >= STAGES[i].min) currentIndex = i;
  }
  const current = STAGES[currentIndex];
  const next = STAGES[currentIndex + 1] || null;
  const progress = next ? Math.max(0, Math.min(100, Math.round(((points - current.min) / (next.min - current.min)) * 100))) : 100;
  return { current, next, progress, stageNumber: currentIndex + 1, totalStages: STAGES.length };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
  if (!workspaceId) return NextResponse.json({ success: false, error: 'workspaceId is required.' }, { status: 400 });
  const supabase = createAdminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    deliveredMessages,
    sentToday,
    trustedEmails,
    autoScoutJobs,
    realReplies,
    realRepliesToday,
    manualReplies,
    gmailAccounts,
    templates,
    schedules,
    dueFollowups,
    noInboxRecords,
    appActivity,
    uniqueSenders,
    businesses
  ] = await Promise.all([
    safeCount(supabase, 'sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered'])),
    safeCount(supabase, 'sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered']).gte('sent_at', today.toISOString())),
    safeCount(supabase, 'businesses', workspaceId, (q) => q.not('email', 'is', null).neq('email', '').in('status', ['ready', 'found', 'connected'])),
    safeCount(supabase, 'email_research_jobs', workspaceId, (q) => q.in('status', ['done', 'found'])),
    safeCount(supabase, 'reply_history', workspaceId, (q) => q.eq('is_real_reply', true).neq('is_auto_reply', true)),
    safeCount(supabase, 'reply_history', workspaceId, (q) => q.eq('is_real_reply', true).neq('is_auto_reply', true).gte('received_at', today.toISOString())),
    safeCount(supabase, 'sent_messages', workspaceId, (q) => q.eq('delivery_status', 'manual_reply_sent')),
    safeCount(supabase, 'gmail_accounts', workspaceId, (q) => q.or('status.eq.connected,status.eq.active,status.eq.ready,status.is.null')),
    safeCount(supabase, 'templates', workspaceId, (q) => q.or('active.eq.true,is_active.eq.true,active.is.null,is_active.is.null')),
    safeCount(supabase, 'message_schedules', workspaceId, (q) => q.in('status', ['scheduled', 'due', 'running', 'completed'])),
    safeCount(supabase, 'message_schedules', workspaceId, (q) => q.in('status', ['due', 'running'])),
    safeCount(supabase, 'no_inbox_records', workspaceId),
    safeCount(supabase, 'activity_logs', workspaceId),
    safeCount(supabase, 'gmail_accounts', workspaceId, (q) => q.not('email', 'is', null).neq('email', '')),
    safeCount(supabase, 'businesses', workspaceId)
  ]);

  const points = Math.round(
    deliveredMessages * 1 +
    sentToday * 0.3 +
    trustedEmails * 0.6 +
    autoScoutJobs * 0.8 +
    businesses * 0.05 +
    realReplies * 350 +
    realRepliesToday * 500 +
    manualReplies * 450 +
    gmailAccounts * 900 +
    uniqueSenders * 350 +
    templates * 80 +
    schedules * 40 +
    dueFollowups * 1.5 +
    noInboxRecords * 0.15 +
    Math.min(appActivity, 5000) * 2
  );

  return NextResponse.json({
    success: true,
    points,
    ...stageFor(points),
    highlights: {
      deliveredMessages,
      sentToday,
      trustedEmails,
      autoScoutJobs,
      realReplies,
      realRepliesToday,
      manualReplies,
      gmailAccounts,
      templates,
      schedules
    }
  });
}
