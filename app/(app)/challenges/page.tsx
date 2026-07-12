import ChallengeBoard from '@/components/ChallengeBoard';
import { createClient } from '@/lib/supabase-server';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export type MetricKey =
  | 'deliveredMessages'
  | 'autoReplies'
  | 'realReplies'
  | 'trustedEmails'
  | 'gmailAccounts'
  | 'templates'
  | 'sentToday'
  | 'dueFollowups'
  | 'schedules'
  | 'autoScoutJobs';

export type Challenge = {
  id: string;
  icon: string;
  title: string;
  metric: MetricKey;
  target: number;
  steps: string[];
};

function milestones(prefix: string, icon: string, metric: MetricKey, values: number[], steps: string[]): Challenge[] {
  return values.map((target) => ({
    id: `${metric}-${target}`,
    icon,
    title: `${prefix} ${target.toLocaleString()}`,
    metric,
    target,
    steps
  }));
}

const challenges: Challenge[] = [
  ...milestones('Send delivered messages', '📨', 'deliveredMessages', [10, 20, 30, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000], [
    'Go to Send Emails.',
    'Choose who should get the email.',
    'Choose your message template.',
    'Choose one Gmail or rotate Gmail senders.',
    'Click Send Now and keep Scout open while it sends.'
  ]),
  ...milestones('Get real replies', '💬', 'realReplies', [1, 3, 5, 10, 20, 30, 50, 75, 100, 200, 500, 1000], [
    'Send useful emails to the right leads.',
    'Go to Replies later.',
    'Click refresh or sync replies.',
    'Scout counts only human replies here.'
  ]),
  ...milestones('Get auto replies', '🤖', 'autoReplies', [10, 25, 50, 100, 250, 500, 1000], [
    'Send emails normally.',
    'Go to Replies.',
    'Scout separates automatic messages like out-of-office or ticket-created emails.'
  ]),
  ...milestones('Find trusted emails', '🔎', 'trustedEmails', [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000], [
    'Go to Find Leads.',
    'Open Find missing emails.',
    'Click Start Auto Scout.',
    'Trusted emails are saved so you can send to them later.'
  ]),
  ...milestones('Connect Gmail accounts', '📮', 'gmailAccounts', [1, 3, 5, 10, 20, 30, 50], [
    'Go to Settings.',
    'Open Gmail accounts.',
    'Connect each Gmail account you want Scout to use.',
    'Set a safe daily limit for every sender.'
  ]),
  ...milestones('Create templates', '✍️', 'templates', [1, 3, 5, 10, 20, 30, 50], [
    'Go to Send Emails.',
    'Click Manage Templates.',
    'Create first-message templates and follow-up templates.',
    'Use clear messages, not spammy words.'
  ]),
  ...milestones('Send today', '⚡', 'sentToday', [10, 25, 50, 100, 250, 500, 1000, 2000, 5000], [
    'Go to Send Emails.',
    'Choose a safe batch or your normal batch.',
    'Click Send Now.',
    'Live Work shows what is being sent right now.'
  ]),
  ...milestones('Have due follow-ups ready', '↩️', 'dueFollowups', [10, 25, 50, 100, 250, 500, 1000], [
    'Send first emails.',
    'Wait 72 hours.',
    'Go to Send Emails, then Due Follow-ups.',
    'Click Send Due Follow-ups Now when you are ready.'
  ]),
  ...milestones('Save sends for later', '⏰', 'schedules', [1, 3, 5, 10, 25], [
    'Go to Send Emails.',
    'Choose audience, template, sender, and count.',
    'Pick a date and time.',
    'Click Save Schedule.',
    'Open Scout at that time and click Run Due Sends Now.'
  ]),
  ...milestones('Run Auto Scout jobs', '🧭', 'autoScoutJobs', [10, 50, 100, 250, 500, 1000, 5000, 10000], [
    'Go to Find Leads.',
    'Click Find missing emails.',
    'Click Start Auto Scout.',
    'Results appear lower on the same page and trusted emails are saved to your leads.'
  ])
];

async function safeCount(table: string, workspaceId: string, build?: (query: any) => any) {
  try {
    const supabase = await createClient();
    let query: any = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    if (build) query = build(query);
    const { count } = await query;
    return count || 0;
  } catch {
    return 0;
  }
}

async function loadMetrics(workspaceId: string): Promise<Record<MetricKey, number>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deliveredMessages = await safeCount('sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered']));
  const sentToday = await safeCount('sent_messages', workspaceId, (q) => q.in('status', ['sent', 'delivered']).gte('sent_at', today.toISOString()));
  const autoReplies = await safeCount('reply_history', workspaceId, (q) => q.or('is_auto_reply.eq.true,reply_bucket.eq.auto_reply'));
  const realReplies = await safeCount('reply_history', workspaceId, (q) => q.or('is_real_reply.eq.true,reply_bucket.eq.real_reply'));
  const trustedEmails = await safeCount('businesses', workspaceId, (q) => q.not('email', 'is', null).neq('email', '').in('status', ['ready', 'found', 'connected']));
  const gmailAccounts = await safeCount('gmail_accounts', workspaceId, (q) => q.or('status.eq.connected,status.eq.active,status.is.null'));
  const templates = await safeCount('templates', workspaceId, (q) => q.or('active.eq.true,active.is.null'));
  const schedules = await safeCount('message_schedules', workspaceId, (q) => q.in('status', ['scheduled', 'due', 'running', 'completed']));
  const autoScoutJobs = await safeCount('email_research_jobs', workspaceId, (q) => q.in('status', ['done', 'found']));

  let dueFollowups = 0;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc('get_due_followups', {
      target_workspace: workspaceId,
      limit_rows: 5000,
      followup_segment: 'all_unanswered'
    });
    dueFollowups = Array.isArray(data) ? data.length : 0;
  } catch {
    dueFollowups = 0;
  }

  return { deliveredMessages, autoReplies, realReplies, trustedEmails, gmailAccounts, templates, sentToday, dueFollowups, schedules, autoScoutJobs };
}

export default async function ChallengesPage() {
  const { workspace, error } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {error}</div>;
  const metrics = await loadMetrics(workspace.id);
  return <ChallengeBoard challenges={challenges} metrics={metrics} />;
}
