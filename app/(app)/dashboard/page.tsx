import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCurrentWorkspace } from '@/lib/workspace';
import SendTimeStrip from '@/components/SendTimeStrip';
import DashboardAutoRefresh from '@/components/DashboardAutoRefresh';
import DashboardJobAction from '@/components/DashboardJobAction';
import {
  REPLY_METRIC_SELECT,
  calculateReplyMetrics,
  isUnifiedRealReply,
  type ReplyMetricRow,
  type ReplyMetrics
} from '@/lib/reply-metrics';
import {
  addCalendarDaysInZone,
  addDayBoundaryInZone,
  formatInZone,
  safeTimeZone,
  startOfDayInZone
} from '@/lib/dashboard-time';

export const dynamic = 'force-dynamic';

type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'all';
type DashboardSearchParams = Promise<{ range?: string }> | { range?: string } | undefined;
type CountFilter = { column: string; value: unknown };
type DateWindow = { start?: Date; end?: Date };
type DashboardIssue = { title: string; message: string; href?: string; severity?: 'error' | 'warning' | 'info' };

type QueryResult<T> = {
  value: T;
  error?: string;
  truncated?: boolean;
};

type PeriodDefinition = {
  key: RangeKey;
  label: string;
  shortLabel: string;
  current: DateWindow;
  previous?: DateWindow;
  compareLabel: string;
};

type GmailRow = {
  id?: string;
  email?: string | null;
  status?: string | null;
  is_paused?: boolean | null;
  paused_reason?: string | null;
  paused_until?: string | null;
  health_stage?: string | null;
  health_cap?: number | null;
  hard_restriction_active?: boolean | null;
  hard_restricted_until?: string | null;
  connection_status?: string | null;
  connection_error?: string | null;
  next_eligible_at?: string | null;
  last_health_review_at?: string | null;
};

type ScheduleRow = {
  id: string;
  type?: string | null;
  status?: string | null;
  run_kind?: string | null;
  target_count?: number | null;
  processed_count?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
  scheduled_for?: string | null;
  updated_at?: string | null;
  last_heartbeat_at?: string | null;
  stop_requested?: boolean | null;
  last_error?: string | null;
  raw?: Record<string, unknown> | null;
};

const rangeOptions: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 3 months' },
  { key: 'all', label: 'All time' }
];

const CONTACTABLE_STATUSES = ['ready', 'found', 'connected'];
const ACTIVE_JOB_STATUSES = ['scheduled', 'due', 'running'];
const COMPLETED_JOB_STATUSES = ['sent', 'complete', 'completed'];
const STOPPED_JOB_STATUSES = ['stopped', 'cancelled'];
const CONNECTED_GMAIL_STATUSES = ['connected', 'ready', 'active'];

function formatError(error: unknown) {
  if (!error) return 'Unknown database error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const parts = [row.message, row.details, row.hint, row.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

function periodFor(key: string | undefined, timeZone: string): PeriodDefinition {
  const selected = rangeOptions.some((option) => option.key === key) ? (key as RangeKey) : 'today';
  const now = new Date();
  const todayStart = startOfDayInZone(now, timeZone);
  const yesterdayStart = addDayBoundaryInZone(todayStart, -1, timeZone);
  const twoDaysAgo = addDayBoundaryInZone(todayStart, -2, timeZone);

  if (selected === 'yesterday') {
    return {
      key: 'yesterday',
      label: 'Yesterday',
      shortLabel: 'Yesterday',
      current: { start: yesterdayStart, end: todayStart },
      previous: { start: twoDaysAgo, end: yesterdayStart },
      compareLabel: 'vs previous day'
    };
  }
  if (selected === 'last7') {
    const start = addCalendarDaysInZone(now, -7, timeZone);
    return {
      key: 'last7', label: 'Last 7 days', shortLabel: '7 days',
      current: { start, end: now },
      previous: { start: addCalendarDaysInZone(start, -7, timeZone), end: start },
      compareLabel: 'vs previous 7 days'
    };
  }
  if (selected === 'last30') {
    const start = addCalendarDaysInZone(now, -30, timeZone);
    return {
      key: 'last30', label: 'Last 30 days', shortLabel: '30 days',
      current: { start, end: now },
      previous: { start: addCalendarDaysInZone(start, -30, timeZone), end: start },
      compareLabel: 'vs previous 30 days'
    };
  }
  if (selected === 'last90') {
    const start = addCalendarDaysInZone(now, -90, timeZone);
    return {
      key: 'last90', label: 'Last 3 months', shortLabel: '3 months',
      current: { start, end: now },
      previous: { start: addCalendarDaysInZone(start, -90, timeZone), end: start },
      compareLabel: 'vs previous 3 months'
    };
  }
  if (selected === 'all') {
    return { key: 'all', label: 'All time', shortLabel: 'All time', current: {}, compareLabel: 'no comparison' };
  }
  return {
    key: 'today', label: 'Today', shortLabel: 'Today',
    current: { start: todayStart, end: now },
    previous: { start: yesterdayStart, end: todayStart },
    compareLabel: 'vs yesterday'
  };
}

function applyDateRange(query: any, dateColumn: string | undefined, window?: DateWindow) {
  if (!dateColumn || !window) return query;
  if (window.start) query = query.gte(dateColumn, window.start.toISOString());
  if (window.end) query = query.lt(dateColumn, window.end.toISOString());
  return query;
}

async function countRows(
  supabase: any,
  table: string,
  workspaceId: string,
  options?: {
    filters?: CountFilter[];
    inFilters?: Array<{ column: string; values: unknown[] }>;
    notInFilters?: Array<{ column: string; values: unknown[] }>;
    notNull?: string[];
    notEmpty?: string[];
    dateColumn?: string;
    window?: DateWindow;
    or?: string;
  }
): Promise<QueryResult<number>> {
  try {
    let query: any = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    for (const filter of options?.filters || []) query = query.eq(filter.column, filter.value);
    for (const filter of options?.inFilters || []) query = query.in(filter.column, filter.values as any[]);
    for (const filter of options?.notInFilters || []) query = query.not(filter.column, 'in', `(${filter.values.join(',')})`);
    for (const column of options?.notNull || []) query = query.not(column, 'is', null);
    for (const column of options?.notEmpty || []) query = query.neq(column, '');
    if (options?.or) query = query.or(options.or);
    query = applyDateRange(query, options?.dateColumn, options?.window);
    const { count, error } = await query;
    if (error) throw error;
    return { value: count || 0 };
  } catch (error) {
    return { value: 0, error: formatError(error) };
  }
}

async function fetchPaged<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 100_000
): Promise<QueryResult<T[]>> {
  const rows: T[] = [];
  const pageSize = 1000;
  try {
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data, error } = await buildQuery(from, from + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) return { value: rows };
    }
    return { value: rows, truncated: true };
  } catch (error) {
    return { value: rows, error: formatError(error) };
  }
}

function pctChange(current: number, previous: number) {
  if (previous === 0 && current === 0) return { text: 'No change', tone: 'muted' as const };
  if (previous === 0) return { text: `+${current.toLocaleString()} new`, tone: 'ok' as const };
  const diff = current - previous;
  const pct = (diff / previous) * 100;
  const sign = diff >= 0 ? '+' : '';
  return { text: `${sign}${diff.toLocaleString()} (${sign}${pct.toFixed(1)}%)`, tone: diff >= 0 ? ('ok' as const) : ('bad' as const) };
}

function toneStyle(tone: 'ok' | 'bad' | 'muted') {
  if (tone === 'ok') return { color: 'var(--ok)' };
  if (tone === 'bad') return { color: 'var(--bad)' };
  return { color: 'var(--muted)' };
}

function ratio(numerator: number, denominator: number, decimals = 1) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(decimals)}%` : '0%';
}

function emailsPerReply(sent: number, replies: number) {
  return replies ? (sent / replies).toFixed(1) : '-';
}

function SetupChecklist({ tasks }: { tasks: Array<{ title: string; href: string; done: boolean; hint: string }> }) {
  const done = tasks.filter((task) => task.done).length;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="actions" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Setup checklist</h3>
          <p className="muted" style={{ margin: '6px 0 0' }}>Each item remains complete after you have successfully done it once.</p>
        </div>
        <span className="badge">{done} / {tasks.length} complete</span>
      </div>
      <div className="setup-list" style={{ marginTop: 14 }}>
        {tasks.map((task, index) => (
          <Link href={task.href} className={`setup-item ${task.done ? 'done' : ''}`} key={task.title}>
            <span className="setup-check">{task.done ? '✓' : index + 1}</span>
            <span><strong>{task.title}</strong><small>{task.hint}</small></span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NextActionCard({ title, href, helper }: { title: string; href: string; helper: string }) {
  return <Link className="quick-link-card big-action" href={href}><strong>{title}</strong><span>{helper}</span></Link>;
}

function KpiCard({
  title, value, previous, compareLabel, helper, error
}: {
  title: string;
  value: number | string;
  previous?: number;
  compareLabel?: string;
  helper?: string;
  error?: string;
}) {
  const numeric = typeof value === 'number' && !error ? value : null;
  const change = numeric !== null && previous !== undefined ? pctChange(numeric, previous) : null;
  return (
    <div className="card kpi">
      <div className="title">{title}</div>
      <div className="num" style={error ? { fontSize: 20, color: 'var(--bad)' } : undefined}>
        {error ? 'Unavailable' : typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {change ? <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, ...toneStyle(change.tone) }}>{change.text}</div> : null}
      {compareLabel && !error ? <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{compareLabel}</div> : null}
      {error ? <div style={{ color: 'var(--bad)', marginTop: 8, fontSize: 12, lineHeight: 1.4 }}>{error}</div> : null}
      {helper ? <div className="muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>{helper}</div> : null}
    </div>
  );
}

function AlertPanel({ issues }: { issues: DashboardIssue[] }) {
  if (!issues.length) return (
    <div className="card" style={{ padding: 16, borderColor: 'var(--ok)' }}>
      <strong style={{ color: 'var(--ok)' }}>No operational warnings detected</strong>
      <div className="muted" style={{ marginTop: 5 }}>Dashboard queries, sender status and the central worker are reporting normally.</div>
    </div>
  );
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: 0 }}>Needs attention</h3>
      <div className="stack" style={{ marginTop: 12, gap: 9 }}>
        {issues.slice(0, 12).map((issue, index) => {
          const color = issue.severity === 'error' ? 'var(--bad)' : issue.severity === 'info' ? 'var(--muted)' : '#b7791f';
          const content = (
            <div style={{ borderLeft: `4px solid ${color}`, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
              <strong>{issue.title}</strong>
              <div className="muted" style={{ marginTop: 3, lineHeight: 1.4 }}>{issue.message}</div>
            </div>
          );
          return issue.href ? <Link key={`${issue.title}-${index}`} href={issue.href}>{content}</Link> : <div key={`${issue.title}-${index}`}>{content}</div>;
        })}
      </div>
    </div>
  );
}

async function fetchReplyRows(supabase: any, workspaceId: string, window: DateWindow) {
  return fetchPaged<ReplyMetricRow>((from, to) => {
    let query: any = supabase
      .from('reply_history')
      .select(REPLY_METRIC_SELECT)
      .eq('workspace_id', workspaceId)
      .order('received_at', { ascending: false })
      .range(from, to);
    query = applyDateRange(query, 'received_at', window);
    return query;
  });
}

async function fetchSentPerformanceRows(supabase: any, workspaceId: string, window: DateWindow) {
  return fetchPaged<any>((from, to) => {
    let query: any = supabase
      .from('sent_messages')
      .select('id,template_id,gmail_account_id')
      .eq('workspace_id', workspaceId)
      .in('status', ['sent', 'delivered'])
      .not('provider_message_id', 'is', null)
      .order('sent_at', { ascending: false })
      .range(from, to);
    query = applyDateRange(query, 'sent_at', window);
    return query;
  });
}

async function buildPerformance(supabase: any, workspaceId: string, sentRows: any[], replyRows: ReplyMetricRow[]) {
  const realReplies = replyRows.filter(isUnifiedRealReply);
  const templateIds = Array.from(new Set([...sentRows.map((row) => row.template_id), ...realReplies.map((row: any) => row.template_id)].filter(Boolean)));
  const senderIds = Array.from(new Set([...sentRows.map((row) => row.gmail_account_id), ...realReplies.map((row: any) => row.gmail_account_id)].filter(Boolean)));
  const templateNames = new Map<string, string>();
  const senderEmails = new Map<string, string>();

  if (templateIds.length) {
    const { data, error } = await supabase.from('templates').select('id,name').eq('workspace_id', workspaceId).in('id', templateIds);
    if (error) throw error;
    for (const row of data || []) templateNames.set(row.id, row.name || 'Untitled template');
  }
  if (senderIds.length) {
    const { data, error } = await supabase.from('gmail_accounts').select('id,email').eq('workspace_id', workspaceId).in('id', senderIds);
    if (error) throw error;
    for (const row of data || []) senderEmails.set(row.id, row.email || 'Unknown sender');
  }

  const templateMap = new Map<string, { id: string; name: string; sent: number; replies: number }>();
  const senderMap = new Map<string, { id: string; email: string; sent: number; replies: number }>();
  for (const row of sentRows) {
    const tid = String(row.template_id || '');
    const sid = String(row.gmail_account_id || 'none');
    if (tid) {
      const item = templateMap.get(tid) || { id: tid, name: templateNames.get(tid) || 'Archived or deleted template', sent: 0, replies: 0 };
      item.sent += 1;
      templateMap.set(tid, item);
    }
    const sender = senderMap.get(sid) || { id: sid, email: sid === 'none' ? 'No sender tracked' : (senderEmails.get(sid) || 'Disconnected sender'), sent: 0, replies: 0 };
    sender.sent += 1;
    senderMap.set(sid, sender);
  }
  for (const row of realReplies as any[]) {
    const tid = String(row.template_id || '');
    const sid = String(row.gmail_account_id || 'none');
    if (tid) {
      const item = templateMap.get(tid) || { id: tid, name: templateNames.get(tid) || 'Archived or deleted template', sent: 0, replies: 0 };
      item.replies += 1;
      templateMap.set(tid, item);
    }
    const sender = senderMap.get(sid) || { id: sid, email: sid === 'none' ? 'No sender tracked' : (senderEmails.get(sid) || 'Disconnected sender'), sent: 0, replies: 0 };
    sender.replies += 1;
    senderMap.set(sid, sender);
  }
  return {
    templates: Array.from(templateMap.values()).sort((a, b) => (b.sent - a.sent) || (b.replies - a.replies)).slice(0, 10),
    senders: Array.from(senderMap.values()).sort((a, b) => (b.sent - a.sent) || (b.replies - a.replies)).slice(0, 10)
  };
}

function summarizeGmail(rows: GmailRow[]) {
  const now = Date.now();
  const saved = rows.length;
  let connected = 0;
  let eligible = 0;
  let coolingDown = 0;
  let paused = 0;
  let limited = 0;
  let reconnect = 0;
  let hardRestricted = 0;
  let unavailable = 0;

  for (const row of rows) {
    const status = String(row.status || '').toLowerCase();
    const connection = String(row.connection_status || '').toLowerCase();
    const stage = String(row.health_stage || '').toLowerCase();
    const hardUntil = row.hard_restricted_until ? new Date(row.hard_restricted_until).getTime() : 0;
    const isHard = row.hard_restriction_active === true && (!hardUntil || hardUntil > now);
    const isReconnect = ['error', 'failed', 'needs_reconnect', 'disconnected', 'invalid'].includes(connection)
      || ['oauth_error', 'disconnected', 'error', 'invalid'].includes(status);
    const isPaused = row.is_paused === true || ['paused', 'limit_hit', 'restricted'].includes(status);
    const nextEligible = row.next_eligible_at ? new Date(row.next_eligible_at).getTime() : 0;
    const isCooling = !isPaused && !isHard && nextEligible > now;
    const isLimited = ['assessment', 'restricted', 'recovering'].includes(stage);
    const isConnected = CONNECTED_GMAIL_STATUSES.includes(status);
    const isEligible = isConnected && !isReconnect && !isHard && !isPaused && !isCooling;
    if (isConnected) connected += 1;
    if (isHard) hardRestricted += 1;
    if (isHard || isPaused) unavailable += 1;
    if (isReconnect) reconnect += 1;
    if (isPaused) paused += 1;
    if (isCooling) coolingDown += 1;
    if (isLimited) limited += 1;
    if (isEligible) eligible += 1;
  }
  return { saved, connected, eligible, coolingDown, paused, limited, reconnect, hardRestricted, unavailable };
}

function progressOf(row: ScheduleRow) {
  const target = Math.max(0, Number(row.target_count || 0));
  const processed = Math.max(0, Number(row.processed_count || 0));
  return target > 0 ? Math.min(100, Math.round((processed / target) * 100)) : 0;
}

function friendlyJobError(raw: string | null | undefined) {
  if (!raw) return '';
  let message = String(raw).trim();
  try {
    const parsed = JSON.parse(message);
    message = String(parsed?.message || parsed?.details || parsed?.error || message);
  } catch {
    // Keep plain text.
  }
  const lower = message.toLowerCase();
  if (lower.includes('effective_daily_limit')) return 'Database update required — sender limit field is missing.';
  if (lower.includes('expires_at')) return 'Database update required — reservation expiry field is missing.';
  if (lower.includes('statement timeout') || lower.includes('57014')) return 'Job timed out before it finished.';
  if (lower.includes('no eligible') || lower.includes('no gmail') || lower.includes('no sender')) return 'Waiting for an available Gmail account.';
  if (lower.includes('worker') || lower.includes('cron')) return 'The background message worker is not running.';
  return message.length > 170 ? `${message.slice(0, 167)}…` : message;
}

function jobStatusLabel(row: ScheduleRow) {
  const status = String(row.status || 'unknown').toLowerCase();
  if (row.stop_requested || status === 'stopped' || status === 'cancelled') return 'Stopped';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Sending';
  if (status === 'scheduled' || status === 'due') return 'Queued';
  if (['sent', 'complete', 'completed'].includes(status)) return 'Completed';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function accordionSummary(title: string, summary: string) {
  return (
    <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <span style={{ fontWeight: 950 }}>{title}</span>
      <span className="muted" style={{ fontSize: 12, textAlign: 'right' }}>{summary} · Open</span>
    </summary>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams?: DashboardSearchParams }) {
  const generatedAt = new Date();
  const params = await Promise.resolve(searchParams || {});
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { workspace, error: workspaceError } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {workspaceError}</div>;

  const { data: workspaceMeta, error: workspaceMetaError } = await supabase
    .from('workspaces')
    .select('timezone,extension_settings')
    .eq('id', workspace.id)
    .limit(1)
    .maybeSingle();
  const extensionSettings = (workspaceMeta?.extension_settings || workspace.extension_settings || {}) as Record<string, unknown>;
  const timeZone = safeTimeZone(String(workspaceMeta?.timezone || extensionSettings.timezone || 'UTC'));
  const period = periodFor((params as any).range, timeZone);
  const previous = period.previous;

  const { data: profileRows } = user
    ? await supabase.from('profiles').select('full_name').eq('id', user.id).limit(1)
    : { data: [] as Array<{ full_name?: string | null }> };
  const metadata = (user?.user_metadata || {}) as Record<string, unknown>;
  const fullName = String(profileRows?.[0]?.full_name || metadata.full_name || metadata.name || '').trim();
  const emailName = String(user?.email || '').split('@')[0].trim();
  const welcomeName = (fullName || emailName || 'there').split(/\s+/)[0];

  const [
    totalBusinesses,
    missingEmails,
    readyToEmail,
    duplicates,
    invalidAddresses,
    suppressed,
    unsubscribed,
    doNotContactArchived,
    periodFoundCandidates,
    prevFoundCandidates,
    periodResearchDone,
    prevResearchDone,
    periodSent,
    prevSent,
    sentToday,
    sentRolling24h,
    initialTemplates,
    followUpTemplates,
    totalSentAll,
    manualRepliesAll,
    allTimeRealReplies,
    followUpsSentAll,
    schedulesEver,
    activeJobsCount,
    runningJobsCount,
    completedJobsCount,
    stoppedJobsCount,
    failedJobsCount,
    stoppedFollowupJobsCount,
    periodReplyRows,
    previousReplyRows,
    periodSentRows
  ] = await Promise.all([
    countRows(supabase, 'businesses', workspace.id),
    countRows(supabase, 'businesses', workspace.id, {
      or: 'email.is.null,email.eq.',
      notInFilters: [{ column: 'status', values: ['contacted', 'responded', 'bad_inbox', 'bounced', 'no_inbox', 'blocked', 'invalid', 'duplicate', 'archived', 'unsubscribed', 'do_not_contact', 'sent'] }]
    }),
    countRows(supabase, 'businesses', workspace.id, { inFilters: [{ column: 'status', values: CONTACTABLE_STATUSES }], notNull: ['email'], notEmpty: ['email'] }),
    countRows(supabase, 'businesses', workspace.id, { filters: [{ column: 'status', value: 'duplicate' }] }),
    countRows(supabase, 'businesses', workspace.id, { inFilters: [{ column: 'status', values: ['invalid', 'bad_inbox', 'bounced', 'no_inbox', 'blocked'] }] }),
    countRows(supabase, 'businesses', workspace.id, { inFilters: [{ column: 'status', values: ['unsubscribed', 'do_not_contact', 'archived'] }] }),
    countRows(supabase, 'businesses', workspace.id, { filters: [{ column: 'status', value: 'unsubscribed' }] }),
    countRows(supabase, 'businesses', workspace.id, { inFilters: [{ column: 'status', values: ['do_not_contact', 'archived'] }] }),
    countRows(supabase, 'email_candidates', workspace.id, { dateColumn: 'created_at', window: period.current }),
    previous ? countRows(supabase, 'email_candidates', workspace.id, { dateColumn: 'created_at', window: previous }) : Promise.resolve<QueryResult<number>>({ value: 0 }),
    countRows(supabase, 'email_research_jobs', workspace.id, { filters: [{ column: 'status', value: 'done' }], dateColumn: 'finished_at', window: period.current }),
    previous ? countRows(supabase, 'email_research_jobs', workspace.id, { filters: [{ column: 'status', value: 'done' }], dateColumn: 'finished_at', window: previous }) : Promise.resolve<QueryResult<number>>({ value: 0 }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', window: period.current }),
    previous ? countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', window: previous }) : Promise.resolve<QueryResult<number>>({ value: 0 }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', window: { start: startOfDayInZone(generatedAt, timeZone), end: generatedAt } }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', window: { start: new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000), end: generatedAt } }),
    countRows(supabase, 'templates', workspace.id, { filters: [{ column: 'template_type', value: 'initial' }, { column: 'active', value: true }] }),
    countRows(supabase, 'templates', workspace.id, { filters: [{ column: 'template_type', value: 'follow_up' }, { column: 'active', value: true }] }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'] }),
    countRows(supabase, 'sent_messages', workspace.id, { filters: [{ column: 'delivery_status', value: 'manual_reply_sent' }] }),
    countRows(supabase, 'reply_history', workspace.id, { filters: [{ column: 'is_real_reply', value: true }] }),
    countRows(supabase, 'sent_messages', workspace.id, { filters: [{ column: 'is_follow_up', value: true }], notNull: ['provider_message_id'] }),
    countRows(supabase, 'message_schedules', workspace.id),
    countRows(supabase, 'message_schedules', workspace.id, { inFilters: [{ column: 'status', values: ACTIVE_JOB_STATUSES }] }),
    countRows(supabase, 'message_schedules', workspace.id, { filters: [{ column: 'status', value: 'running' }] }),
    countRows(supabase, 'message_schedules', workspace.id, { inFilters: [{ column: 'status', values: COMPLETED_JOB_STATUSES }] }),
    countRows(supabase, 'message_schedules', workspace.id, { inFilters: [{ column: 'status', values: STOPPED_JOB_STATUSES }] }),
    countRows(supabase, 'message_schedules', workspace.id, { filters: [{ column: 'status', value: 'failed' }] }),
    countRows(supabase, 'message_schedules', workspace.id, { filters: [{ column: 'type', value: 'follow_up' }], inFilters: [{ column: 'status', values: STOPPED_JOB_STATUSES }] }),
    fetchReplyRows(supabase, workspace.id, period.current),
    previous ? fetchReplyRows(supabase, workspace.id, previous) : Promise.resolve<QueryResult<ReplyMetricRow[]>>({ value: [] as ReplyMetricRow[] }),
    fetchSentPerformanceRows(supabase, workspace.id, period.current)
  ]);

  const periodReplyMetrics: ReplyMetrics = calculateReplyMetrics(periodReplyRows.value);
  const previousReplyMetrics: ReplyMetrics = calculateReplyMetrics(previousReplyRows.value);

  let performance: QueryResult<{ templates: Array<{ id: string; name: string; sent: number; replies: number }>; senders: Array<{ id: string; email: string; sent: number; replies: number }> }> = { value: { templates: [], senders: [] } };
  if (periodReplyRows.error || periodSentRows.error) {
    performance.error = periodReplyRows.error || periodSentRows.error;
  } else {
    try {
      performance.value = await buildPerformance(supabase, workspace.id, periodSentRows.value, periodReplyRows.value);
    } catch (error) {
      performance.error = formatError(error);
    }
  }
  performance.truncated = periodReplyRows.truncated || periodSentRows.truncated;

  let gmailRowsResult: QueryResult<GmailRow[]> = { value: [] };
  const richGmail = await supabase
    .from('gmail_accounts')
    .select('id,email,status,is_paused,paused_reason,paused_until,health_stage,health_cap,hard_restriction_active,hard_restricted_until,connection_status,connection_error,next_eligible_at,last_health_review_at')
    .eq('workspace_id', workspace.id)
    .order('email', { ascending: true });
  if (richGmail.error) {
    const fallback = await supabase.from('gmail_accounts').select('id,email,status').eq('workspace_id', workspace.id).order('email', { ascending: true });
    gmailRowsResult = {
      value: (fallback.data || []) as GmailRow[],
      error: fallback.error ? `${formatError(richGmail.error)} · Fallback failed: ${formatError(fallback.error)}` : `Sender health details could not load: ${formatError(richGmail.error)}`
    };
  } else {
    gmailRowsResult.value = (richGmail.data || []) as GmailRow[];
  }
  const gmailSummary = summarizeGmail(gmailRowsResult.value);

  const activeSchedules = await fetchPaged<ScheduleRow>((from, to) => supabase
    .from('message_schedules')
    .select('id,type,status,run_kind,target_count,processed_count,sent_count,failed_count,skipped_count,scheduled_for,updated_at,last_heartbeat_at,stop_requested,last_error,raw')
    .eq('workspace_id', workspace.id)
    .in('status', ACTIVE_JOB_STATUSES)
    .order('updated_at', { ascending: false })
    .range(from, to), 10_000);

  const recentSchedulesResponse = await supabase
    .from('message_schedules')
    .select('id,type,status,run_kind,target_count,processed_count,sent_count,failed_count,skipped_count,scheduled_for,updated_at,last_heartbeat_at,stop_requested,last_error,raw')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(12);
  const recentSchedules: QueryResult<ScheduleRow[]> = recentSchedulesResponse.error
    ? { value: [], error: formatError(recentSchedulesResponse.error) }
    : { value: (recentSchedulesResponse.data || []) as ScheduleRow[] };

  const queuedContacts = activeSchedules.value.reduce((total, row) => total + Math.max(0, Number(row.target_count || 0) - Number(row.processed_count || 0)), 0);
  const staleCutoff = Date.now() - 10 * 60 * 1000;
  const staleJobs = activeSchedules.value.filter((row) => {
    const heartbeat = row.last_heartbeat_at || row.updated_at;
    return heartbeat ? new Date(heartbeat).getTime() < staleCutoff : false;
  });
  const followupSending = activeSchedules.value.filter((row) => row.type === 'follow_up' && row.status === 'running').length;
  const followupScheduledLater = activeSchedules.value.filter((row) => row.type === 'follow_up' && row.status === 'scheduled' && new Date(row.scheduled_for || 0).getTime() > generatedAt.getTime()).length;
  const followupDueOrQueued = activeSchedules.value.filter((row) => row.type === 'follow_up' && ['scheduled', 'due'].includes(String(row.status || '')) && new Date(row.scheduled_for || 0).getTime() <= generatedAt.getTime()).length;
  const followupBlocked = activeSchedules.value.filter((row) => row.type === 'follow_up' && /no eligible|no gmail|no sender/i.test(String(row.last_error || ''))).length;

  let dueFollowups: QueryResult<number> = { value: 0 };
  try {
    const { data, error } = await supabase.rpc('get_due_followups', { target_workspace: workspace.id, limit_rows: 100000 });
    if (error) throw error;
    dueFollowups = { value: (data || []).length, truncated: (data || []).length >= 100000 };
  } catch (error) {
    dueFollowups.error = formatError(error);
  }

  let workerStatus: QueryResult<Record<string, unknown>> = { value: {} };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('scout_message_worker_status');
    if (error) throw error;
    workerStatus.value = (Array.isArray(data) ? data[0] : data) || {};
  } catch (error) {
    workerStatus.error = formatError(error);
  }
  const worker = workerStatus.value;
  const workerReady = worker.ready === true && worker.active === true;
  const workerLastStatus = String(worker.last_run_status || '');
  const workerLabel = workerStatus.error ? 'Misconfigured' : workerReady ? (workerLastStatus === 'failed' ? 'Not responding' : 'Running') : 'Not running';

  const latestSentResponse = await supabase
    .from('sent_messages')
    .select('sent_at')
    .eq('workspace_id', workspace.id)
    .in('status', ['sent', 'delivered'])
    .not('provider_message_id', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestSuccessfulSend = latestSentResponse.error ? null : latestSentResponse.data?.sent_at;

  const issues: DashboardIssue[] = [];
  const addQueryIssue = (title: string, result: QueryResult<unknown>, href?: string) => {
    if (result.error) issues.push({ title, message: result.error, href, severity: 'error' });
    if (result.truncated) issues.push({ title: `${title} reached the display limit`, message: 'The exact KPI count is still shown, but the detailed breakdown was limited to 100,000 rows.', href, severity: 'warning' });
  };
  if (workspaceMetaError) issues.push({ title: 'Workspace timezone could not load', message: `${formatError(workspaceMetaError)} Scout is using UTC until this is corrected.`, href: '/settings', severity: 'error' });
  [
    ['Businesses could not load', totalBusinesses, '/upload'],
    ['Missing-email count could not load', missingEmails, '/auto-scout'],
    ['Ready contacts could not load', readyToEmail, '/verify'],
    ['Sent-message activity could not load', periodSent, '/message'],
    ['Reply activity could not load', periodReplyRows, '/replies'],
    ['Sender status could not load', gmailRowsResult, '/settings'],
    ['Active jobs could not load', activeSchedules, '/message'],
    ['Recent jobs could not load', recentSchedules, '/message'],
    ['Due follow-ups could not load', dueFollowups, '/message'],
    ['Worker status could not load', workerStatus, '/settings'],
    ['Performance details could not load', performance, '/dashboard']
  ].forEach(([title, result, href]) => addQueryIssue(String(title), result as QueryResult<unknown>, String(href)));

  if (!workerReady) issues.push({ title: 'Central message worker is not running', message: workerStatus.error || String(worker.error || 'The Supabase Cron worker is inactive or not configured.'), href: '/settings', severity: 'error' });
  if (workerLastStatus === 'failed') issues.push({ title: 'Latest worker run failed', message: String(worker.last_message || 'Open the Message page to inspect the latest job error.'), href: '/message', severity: 'error' });
  if (gmailSummary.reconnect > 0) issues.push({ title: `${gmailSummary.reconnect} Gmail account${gmailSummary.reconnect === 1 ? '' : 's'} need reconnection`, message: 'Scout cannot use these accounts until Google access is restored.', href: '/settings', severity: 'error' });
  if (gmailSummary.hardRestricted > 0) issues.push({ title: `${gmailSummary.hardRestricted} Gmail account${gmailSummary.hardRestricted === 1 ? '' : 's'} hard restricted`, message: 'The Resume control remains unavailable until the restriction period ends.', href: '/settings', severity: 'warning' });
  if (gmailSummary.paused > 0) issues.push({ title: `${gmailSummary.paused} Gmail account${gmailSummary.paused === 1 ? '' : 's'} paused`, message: 'Open Settings to see each exact reason and the available resume action.', href: '/settings', severity: 'warning' });
  if (staleJobs.length > 0) issues.push({ title: `${staleJobs.length} sending job${staleJobs.length === 1 ? '' : 's'} have not progressed for 10 minutes`, message: 'The job may be waiting for sender cooldown, or the worker may have stopped.', href: '/message', severity: 'warning' });
  if (failedJobsCount.value > 0) issues.push({ title: `${failedJobsCount.value} failed sending job${failedJobsCount.value === 1 ? '' : 's'}`, message: 'Open Message to see the exact error and restart only after correcting it.', href: '/message', severity: 'error' });
  if (periodReplyMetrics.deliveryFailures > 0) issues.push({ title: `${periodReplyMetrics.deliveryFailures} delivery failure${periodReplyMetrics.deliveryFailures === 1 ? '' : 's'} in ${period.label.toLowerCase()}`, message: 'Review and suppress bad recipient addresses before the next run.', href: '/replies', severity: 'warning' });
  if (periodReplyMetrics.limitNotices > 0) issues.push({ title: `${periodReplyMetrics.limitNotices} Gmail limit notice${periodReplyMetrics.limitNotices === 1 ? '' : 's'}`, message: 'Scout will pause or restrict the affected Gmail according to its health history.', href: '/settings', severity: 'error' });
  if (duplicates.value > 0) issues.push({ title: `${duplicates.value} duplicate contact${duplicates.value === 1 ? '' : 's'} excluded`, message: 'These contacts are not eligible for sending.', href: '/upload', severity: 'info' });

  const periodReplies = periodReplyMetrics.realReplies;
  const prevReplies = previousReplyMetrics.realReplies;
  const responseRate = ratio(periodReplies, periodSent.value);
  const perReply = emailsPerReply(periodSent.value, periodReplies);
  const setupTasks = [
    { title: 'Connect your Gmail accounts', href: '/settings', done: gmailSummary.connected > 0, hint: 'Connect at least one Gmail account and confirm that its connection works.' },
    { title: 'Add your first-message templates', href: '/templates', done: initialTemplates.value > 0, hint: 'Active initial templates are used for new contacts.' },
    { title: 'Add your follow-up templates', href: '/templates', done: followUpTemplates.value > 0, hint: 'Active follow-up templates are used after no reply.' },
    { title: 'Import your lead list', href: '/upload', done: totalBusinesses.value > 0, hint: 'Upload CSV leads before researching or sending.' },
    { title: 'Get trusted emails ready', href: '/verify', done: readyToEmail.value > 0, hint: 'Ready, found and connected contacts with an email are counted consistently across Scout.' },
    { title: 'Send your first message', href: '/message', done: totalSentAll.value > 0, hint: 'A send counts only after Gmail returns a provider message ID.' },
    { title: 'Check a real reply', href: '/replies', done: allTimeRealReplies.value > 0, hint: 'This remains complete even when the current analytics period has no replies.' },
    { title: 'Respond to a prospect from Scout', href: '/replies', done: manualRepliesAll.value > 0, hint: 'Open a Scout-tracked reply and send your response.' },
    { title: 'Send a follow-up', href: '/message', done: followUpsSentAll.value > 0, hint: 'This completes only after at least one follow-up was actually sent.' },
    { title: 'Create a saved sending job', href: '/message', done: schedulesEver.value > 0, hint: 'The central worker continues a saved job safely even after Scout is closed.' }
  ];

  const currentActivity = recentSchedules.value
    .filter((row) => ACTIVE_JOB_STATUSES.includes(String(row.status || '')) || String(row.status || '') === 'failed')
    .slice(0, 4);
  const setupDone = setupTasks.filter((task) => task.done).length;
  const attentionCount = issues.length;

  return (
    <div className="stack" style={{ gap: 22, maxWidth: 1220 }}>
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div className="page-title">
          <h2 style={{ marginBottom: 5 }}>Welcome back, {welcomeName}</h2>
          <p>{workspace.name} · Analytics timezone: <strong>{timeZone}</strong></p>
        </div>
        <DashboardAutoRefresh generatedAt={generatedAt.toISOString()} />
      </div>

      {!workerReady ? (
        <div className="card" style={{ padding: 16, borderColor: 'var(--bad)', background: 'color-mix(in srgb, var(--bad) 7%, var(--surface))' }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div>
              <strong>Background message worker offline</strong>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                App-open sending may continue while Scout is visible, but saved jobs will not continue reliably after Scout closes.
              </div>
            </div>
            <Link href="/settings" className="btn secondary mini">View fix</Link>
          </div>
        </div>
      ) : null}

      {attentionCount > 0 ? (
        <details className="card" style={{ padding: 16 }}>
          {accordionSummary(`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`, [
            gmailSummary.reconnect ? `${gmailSummary.reconnect} reconnect` : '',
            gmailSummary.paused ? `${gmailSummary.paused} paused` : '',
            failedJobsCount.value ? `${failedJobsCount.value} failed job${failedJobsCount.value === 1 ? '' : 's'}` : '',
          ].filter(Boolean).join(' · ') || 'Open for details')}
          <div style={{ marginTop: 14 }}><AlertPanel issues={issues} /></div>
        </details>
      ) : workerReady ? (
        <div className="card" style={{ padding: 14, borderColor: 'var(--ok)' }}>
          <strong style={{ color: 'var(--ok)' }}>Scout is working normally</strong>
        </div>
      ) : null}

      <section className="card" style={{ padding: 16 }}>
        <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Performance overview</h3>
            <p className="muted" style={{ margin: '5px 0 0' }}>Showing {period.label} in {timeZone}. Use one filter for scouting, sending and reply metrics.</p>
          </div>
          <div className="actions" style={{ gap: 7, flexWrap: 'wrap' }}>
            {rangeOptions.map((option) => (
              <Link
                key={option.key}
                className={`btn ${period.key === option.key ? '' : 'secondary'}`}
                href={`/dashboard?range=${option.key}`}
                style={{ padding: '8px 11px' }}
              >
                {option.label}
              </Link>
            ))}
            <a className="btn secondary" href="/api/reports/today" style={{ padding: '8px 11px' }}>Download today</a>
          </div>
        </div>
      </section>

      <div className="grid grid-4">
        <KpiCard
          title={`Contacts scouted (${period.shortLabel})`}
          value={periodResearchDone.value}
          previous={previous && !prevResearchDone.error ? prevResearchDone.value : undefined}
          compareLabel={period.compareLabel}
          error={periodResearchDone.error}
          helper="Completed Auto Scout research checks."
        />
        <KpiCard
          title={`Emails found (${period.shortLabel})`}
          value={periodFoundCandidates.value}
          previous={previous && !prevFoundCandidates.error ? prevFoundCandidates.value : undefined}
          compareLabel={period.compareLabel}
          error={periodFoundCandidates.error}
          helper="New email candidates discovered by Scout."
        />
        <KpiCard
          title={`Verified sends (${period.shortLabel})`}
          value={periodSent.value}
          previous={previous && !prevSent.error ? prevSent.value : undefined}
          compareLabel={period.compareLabel}
          error={periodSent.error}
          helper="Counted after Gmail returns a provider message ID."
        />
        <KpiCard
          title={`Real replies (${period.shortLabel})`}
          value={periodReplies}
          previous={previous && !previousReplyRows.error ? prevReplies : undefined}
          compareLabel={period.compareLabel}
          error={periodReplyRows.error}
          helper="Prepared for reply tracking; automated and delivery messages stay separate."
        />
      </div>

      <div className="grid grid-3">
        <NextActionCard title="Find missing emails" href="/source-scout" helper={`${missingEmails.value.toLocaleString()} contacts still need a usable email.`} />
        <NextActionCard title="Send emails" href="/message" helper={`${queuedContacts.toLocaleString()} queued · ${activeJobsCount.value.toLocaleString()} active job(s).`} />
        <NextActionCard title="Review replies" href="/replies" helper={`${periodReplies.toLocaleString()} real replies in ${period.label.toLowerCase()} · ${dueFollowups.value.toLocaleString()} follow-ups due.`} />
      </div>

      {dueFollowups.value > 0 && !dueFollowups.error ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div>
              <strong>{dueFollowups.value.toLocaleString()} follow-up{dueFollowups.value === 1 ? '' : 's'} ready</strong>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Scout applies the same automatic Gmail limits and pacing.</div>
            </div>
            <Link href="/message" className="btn">Send follow-ups</Link>
          </div>
        </div>
      ) : null}

      <section>
        <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Current activity</h3>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Only active, queued and recently failed jobs are visible here.</div>
          </div>
          <Link href="/message" className="btn secondary mini">View all jobs</Link>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {currentActivity.map((row) => {
            const label = jobStatusLabel(row);
            const progress = progressOf(row);
            const error = friendlyJobError(row.last_error);
            const isActive = ACTIVE_JOB_STATUSES.includes(String(row.status || '')) && !row.stop_requested;
            const isFailed = String(row.status || '') === 'failed';
            return (
              <div className="card" style={{ padding: 16 }} key={row.id}>
                <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="actions" style={{ gap: 8 }}>
                      <strong>{row.type === 'follow_up' ? 'Follow-up outreach' : 'Initial outreach'}</strong>
                      <span className="badge">{label}</span>
                    </div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                      {Number(row.processed_count || 0).toLocaleString()} of {Number(row.target_count || 0).toLocaleString()} processed · {Number(row.sent_count || 0).toLocaleString()} sent
                    </div>
                    <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', marginTop: 11 }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: label === 'Failed' ? 'var(--bad)' : 'var(--ok)', borderRadius: 999 }} />
                    </div>
                    {error ? <div style={{ color: label === 'Failed' ? 'var(--bad)' : 'var(--muted)', marginTop: 9, fontSize: 13 }}>{error}</div> : null}
                    <div className="muted" style={{ marginTop: 7, fontSize: 12 }}>Updated {formatInZone(row.last_heartbeat_at || row.updated_at, timeZone)}</div>
                  </div>
                  <div className="actions" style={{ justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap' }}>
                    <Link href="/message" className="btn secondary mini">Details</Link>
                    {isActive ? <DashboardJobAction workspaceId={workspace.id} scheduleId={row.id} action="stop" label="Stop" /> : null}
                    {isFailed ? <DashboardJobAction workspaceId={workspace.id} scheduleId={row.id} action="continue" label="Retry" /> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {!currentActivity.length && !recentSchedules.error ? (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <strong>No active or failed jobs</strong>
              <div className="muted" style={{ marginTop: 5 }}>New sending activity will appear here.</div>
            </div>
          ) : null}
        </div>
      </section>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Outreach performance', `${responseRate} reply rate · ${periodReplyMetrics.deliveryFailures} delivery issue(s)`)}
        <div style={{ marginTop: 18 }} className="stack">
          <div className="grid grid-4">
            <KpiCard title="Real reply rate" value={responseRate} error={periodSent.error || periodReplyRows.error} helper={`${periodReplies.toLocaleString()} real replies from ${periodSent.value.toLocaleString()} verified sends.`} />
            <KpiCard title="Emails / real reply" value={perReply} error={periodSent.error || periodReplyRows.error} helper="Lower is better." />
            <KpiCard title={`Delivery failures (${period.shortLabel})`} value={periodReplyMetrics.deliveryFailures} error={periodReplyRows.error} helper="Bounces, blocked messages and other delivery failures." />
            <KpiCard title={`Automatic replies (${period.shortLabel})`} value={periodReplyMetrics.autoReplies} error={periodReplyRows.error} helper="Out-of-office and similar automated messages." />
          </div>
          <div className="grid grid-4">
            <KpiCard title={`Gmail limit notices (${period.shortLabel})`} value={periodReplyMetrics.limitNotices} error={periodReplyRows.error} />
            <KpiCard title="Due follow-ups" value={dueFollowups.truncated ? `${dueFollowups.value.toLocaleString()}+` : dueFollowups.value} error={dueFollowups.error} />
            <KpiCard title="Follow-up jobs" value={followupSending + followupScheduledLater + followupDueOrQueued} error={activeSchedules.error} helper={`${followupSending} running · ${followupScheduledLater} later · ${followupDueOrQueued} queued · ${followupBlocked} blocked.`} />
            <KpiCard title="Sent today / rolling 24h" value={`${sentToday.value.toLocaleString()} / ${sentRolling24h.value.toLocaleString()}`} error={sentToday.error || sentRolling24h.error} helper={`Calendar day uses ${timeZone}.`} />
          </div>
        </div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Lead and scouting details', `${readyToEmail.value.toLocaleString()} ready · ${missingEmails.value.toLocaleString()} need email`)}
        <div style={{ marginTop: 18 }} className="grid grid-4">
          <KpiCard title="Total contacts" value={totalBusinesses.value} error={totalBusinesses.error} />
          <KpiCard title="Needs email" value={missingEmails.value} error={missingEmails.error} />
          <KpiCard title="Ready to email" value={readyToEmail.value} error={readyToEmail.error} />
          <KpiCard title="Invalid / blocked" value={invalidAddresses.value} error={invalidAddresses.error} />
          <KpiCard title="Duplicate contacts" value={duplicates.value} error={duplicates.error} />
          <KpiCard title="Unsubscribed" value={unsubscribed.value} error={unsubscribed.error} />
          <KpiCard title="Other suppressed" value={doNotContactArchived.value} error={doNotContactArchived.error} helper={`${suppressed.value.toLocaleString()} total suppressed including unsubscribes.`} />
          <KpiCard title="Completed Scout checks" value={periodResearchDone.value} error={periodResearchDone.error} helper={`For ${period.label.toLowerCase()}.`} />
        </div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Template and sender performance', `${performance.value.templates.length} template(s) · ${performance.value.senders.length} sender(s)`)}
        <div className="grid grid-2" style={{ marginTop: 18 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Template performance — {period.label}</h3>
            {performance.error ? <div className="error">{performance.error}</div> : null}
            <div className="table-wrap"><table><thead><tr><th>Template</th><th>Sent</th><th>Replies</th><th>Rate</th><th>Emails / reply</th></tr></thead><tbody>
              {performance.value.templates.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.sent.toLocaleString()}</td><td>{row.replies.toLocaleString()}</td><td>{ratio(row.replies, row.sent)}</td><td>{emailsPerReply(row.sent, row.replies)}</td></tr>)}
              {!performance.value.templates.length && !performance.error ? <tr><td colSpan={5} className="muted">No template performance in this period yet.</td></tr> : null}
            </tbody></table></div>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Sender performance — {period.label}</h3>
            {performance.error ? <div className="error">{performance.error}</div> : null}
            <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Sent</th><th>Replies</th><th>Rate</th><th>Emails / reply</th></tr></thead><tbody>
              {performance.value.senders.map((row) => <tr key={row.id}><td>{row.email}</td><td>{row.sent.toLocaleString()}</td><td>{row.replies.toLocaleString()}</td><td>{ratio(row.replies, row.sent)}</td><td>{emailsPerReply(row.sent, row.replies)}</td></tr>)}
              {!performance.value.senders.length && !performance.error ? <tr><td colSpan={5} className="muted">No sender performance in this period yet.</td></tr> : null}
            </tbody></table></div>
          </div>
        </div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Gmail, worker and timezone', `${gmailSummary.eligible} available · worker ${workerLabel.toLowerCase()} · ${timeZone}`)}
        <div className="stack" style={{ marginTop: 18 }}>
          <div className="grid grid-4">
            <KpiCard title="Available Gmail" value={gmailSummary.eligible} error={gmailRowsResult.error && !gmailRowsResult.value.length ? gmailRowsResult.error : undefined} />
            <KpiCard title="Cooling down" value={gmailSummary.coolingDown} />
            <KpiCard title="Paused / restricted" value={gmailSummary.paused + gmailSummary.hardRestricted} />
            <KpiCard title="Needs reconnect" value={gmailSummary.reconnect} />
          </div>
          <div className="grid grid-3">
            <KpiCard title="Background worker" value={workerLabel} helper={`Schedule: ${String(worker.schedule || 'not available')} · Last success: ${formatInZone(worker.last_success_at as string | undefined, timeZone)}`} />
            <KpiCard title="Last verified send" value={latestSuccessfulSend ? formatInZone(latestSuccessfulSend, timeZone) : 'No verified send yet'} />
            <KpiCard title="Workspace timezone" value={timeZone} helper="Today, Yesterday and report ranges use this timezone." />
          </div>
          <details className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 900 }}>Check best sending time</summary>
            <div style={{ marginTop: 12 }}><SendTimeStrip /></div>
          </details>
        </div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Setup progress', `${setupDone} of ${setupTasks.length} complete`)}
        <div style={{ marginTop: 16 }}><SetupChecklist tasks={setupTasks} /></div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        {accordionSummary('Recent job history', `${completedJobsCount.value} completed · ${failedJobsCount.value} failed · ${stoppedJobsCount.value} stopped`)}
        <div style={{ marginTop: 16 }}>
          {recentSchedules.error ? <div className="error">{recentSchedules.error}</div> : null}
          <div className="table-wrap"><table><thead><tr><th>Type</th><th>Scheduled</th><th>Progress</th><th>Sent</th><th>Failed</th><th>Status</th><th>Updated</th><th>Reason</th></tr></thead><tbody>
            {recentSchedules.value.map((row) => (
              <tr key={row.id}>
                <td>{row.type || row.run_kind || 'message'}</td>
                <td>{formatInZone(row.scheduled_for, timeZone)}</td>
                <td>{Number(row.processed_count || 0).toLocaleString()} / {Number(row.target_count || 0).toLocaleString()} ({progressOf(row)}%)</td>
                <td>{Number(row.sent_count || 0).toLocaleString()}</td>
                <td>{Number(row.failed_count || 0).toLocaleString()}</td>
                <td>{jobStatusLabel(row)}</td>
                <td>{formatInZone(row.last_heartbeat_at || row.updated_at, timeZone)}</td>
                <td style={{ maxWidth: 300 }}>{friendlyJobError(row.last_error) || '—'}</td>
              </tr>
            ))}
            {!recentSchedules.value.length && !recentSchedules.error ? <tr><td colSpan={8} className="muted">No message jobs yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </details>
    </div>
  );
}
