import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Mail, MessageCircle, Search, Send, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCurrentWorkspace } from '@/lib/workspace';
import DashboardAutoRefresh from '@/components/DashboardAutoRefresh';
import DashboardJobAction from '@/components/DashboardJobAction';
import { REPLY_METRIC_SELECT, calculateReplyMetrics, type ReplyMetricRow } from '@/lib/reply-metrics';
import { addCalendarDaysInZone, formatInZone, safeTimeZone, startOfDayInZone } from '@/lib/dashboard-time';

export const dynamic = 'force-dynamic';

type QueryResult<T> = { value: T; error?: string };
type GmailRow = {
  id?: string;
  email?: string | null;
  status?: string | null;
  is_paused?: boolean | null;
  health_stage?: string | null;
  hard_restriction_active?: boolean | null;
  hard_restricted_until?: string | null;
  connection_status?: string | null;
  next_eligible_at?: string | null;
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
  updated_at?: string | null;
  last_heartbeat_at?: string | null;
  stop_requested?: boolean | null;
  last_error?: string | null;
};

const CONTACTABLE_STATUSES = ['ready', 'found', 'connected'];
const ACTIVE_JOB_STATUSES = ['scheduled', 'due', 'running'];
const CONNECTED_GMAIL_STATUSES = ['connected', 'ready', 'active'];

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return String(row.message || row.details || row.hint || row.code || 'Unknown error.');
  }
  return String(error);
}

async function countRows(
  supabase: any,
  table: string,
  workspaceId: string,
  options?: {
    filters?: Array<{ column: string; value: unknown }>;
    inFilters?: Array<{ column: string; values: unknown[] }>;
    notNull?: string[];
    dateColumn?: string;
    start?: Date;
    end?: Date;
  }
): Promise<QueryResult<number>> {
  try {
    let query: any = supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
    for (const filter of options?.filters || []) query = query.eq(filter.column, filter.value);
    for (const filter of options?.inFilters || []) query = query.in(filter.column, filter.values as any[]);
    for (const column of options?.notNull || []) query = query.not(column, 'is', null);
    if (options?.dateColumn && options.start) query = query.gte(options.dateColumn, options.start.toISOString());
    if (options?.dateColumn && options.end) query = query.lt(options.dateColumn, options.end.toISOString());
    const { count, error } = await query;
    if (error) throw error;
    return { value: count || 0 };
  } catch (error) {
    return { value: 0, error: formatError(error) };
  }
}

async function fetchReplyRows(supabase: any, workspaceId: string, start: Date, end: Date): Promise<QueryResult<ReplyMetricRow[]>> {
  try {
    const rows: ReplyMetricRow[] = [];
    const pageSize = 1000;
    for (let from = 0; from < 100_000; from += pageSize) {
      const { data, error } = await supabase
        .from('reply_history')
        .select(REPLY_METRIC_SELECT)
        .eq('workspace_id', workspaceId)
        .gte('received_at', start.toISOString())
        .lt('received_at', end.toISOString())
        .order('received_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data || []) as ReplyMetricRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return { value: rows };
  } catch (error) {
    return { value: [], error: formatError(error) };
  }
}

function summarizeGmail(rows: GmailRow[]) {
  const now = Date.now();
  let available = 0;
  let paused = 0;
  let reconnect = 0;
  let cooling = 0;
  let restricted = 0;

  for (const row of rows) {
    const status = String(row.status || '').toLowerCase();
    const connection = String(row.connection_status || '').toLowerCase();
    const stage = String(row.health_stage || '').toLowerCase();
    const hardUntil = row.hard_restricted_until ? new Date(row.hard_restricted_until).getTime() : 0;
    const isHard = row.hard_restriction_active === true && (!hardUntil || hardUntil > now);
    const needsReconnect = ['error', 'failed', 'needs_reconnect', 'disconnected', 'invalid'].includes(connection)
      || ['oauth_error', 'disconnected', 'error', 'invalid'].includes(status);
    const isPaused = row.is_paused === true || isHard || ['paused', 'limit_hit', 'restricted'].includes(status);
    const nextEligible = row.next_eligible_at ? new Date(row.next_eligible_at).getTime() : 0;
    const isCooling = !isPaused && nextEligible > now;
    const connected = CONNECTED_GMAIL_STATUSES.includes(status);

    if (needsReconnect) reconnect += 1;
    if (isPaused) paused += 1;
    if (isCooling) cooling += 1;
    if (['assessment', 'restricted', 'recovering'].includes(stage)) restricted += 1;
    if (connected && !needsReconnect && !isPaused && !isCooling) available += 1;
  }

  return { total: rows.length, available, paused, reconnect, cooling, restricted };
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
    // Keep plain-text errors as-is.
  }
  const lower = message.toLowerCase();
  if (lower.includes('effective_daily_limit')) return 'Database update required — sender limit field is missing.';
  if (lower.includes('expires_at')) return 'Database update required — reservation expiry field is missing.';
  if (lower.includes('statement timeout') || lower.includes('57014')) return 'Job timed out before it finished.';
  if (lower.includes('no eligible') || lower.includes('no gmail') || lower.includes('no sender')) return 'Waiting for an available Gmail account.';
  if (lower.includes('worker') || lower.includes('cron')) return 'The message worker is not running.';
  return message.length > 150 ? `${message.slice(0, 147)}…` : message;
}

function statusLabel(row: ScheduleRow) {
  const status = String(row.status || 'unknown').toLowerCase();
  if (row.stop_requested || status === 'stopped' || status === 'cancelled') return 'Stopped';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Sending';
  if (status === 'scheduled' || status === 'due') return 'Queued';
  if (['sent', 'complete', 'completed'].includes(status)) return 'Completed';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(label: string) {
  if (label === 'Failed') return 'var(--bad)';
  if (label === 'Sending') return 'var(--ok)';
  if (label === 'Queued') return '#b7791f';
  return 'var(--muted)';
}

function MetricCard({
  icon,
  title,
  primary,
  secondary,
  href,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  primary: string;
  secondary: string;
  href: string;
  error?: string;
}) {
  return (
    <Link href={href} className="card" style={{ padding: 18, display: 'block', minHeight: 138 }}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}>{icon}</span>
        <ArrowRight size={17} className="muted" />
      </div>
      <div className="muted" style={{ marginTop: 13, fontSize: 13, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 25, fontWeight: 950, marginTop: 4 }}>{error ? 'Unavailable' : primary}</div>
      <div className="muted" style={{ marginTop: 5, fontSize: 13 }}>{error ? 'Some data could not load.' : secondary}</div>
    </Link>
  );
}

function QuickAction({ icon, title, href }: { icon: React.ReactNode; title: string; href: string }) {
  return (
    <Link href={href} className="btn secondary" style={{ minHeight: 48, justifyContent: 'center', gap: 9 }}>
      {icon}{title}
    </Link>
  );
}

export default async function DashboardPage() {
  const generatedAt = new Date();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { workspace, error: workspaceError } = await getCurrentWorkspace();
  if (!workspace) return <div className="error">Workspace error: {workspaceError}</div>;

  const { data: workspaceMeta } = await supabase
    .from('workspaces')
    .select('timezone,extension_settings')
    .eq('id', workspace.id)
    .limit(1)
    .maybeSingle();
  const extensionSettings = (workspaceMeta?.extension_settings || workspace.extension_settings || {}) as Record<string, unknown>;
  const timeZone = safeTimeZone(String(workspaceMeta?.timezone || extensionSettings.timezone || 'UTC'));
  const todayStart = startOfDayInZone(generatedAt, timeZone);
  const last7Start = addCalendarDaysInZone(generatedAt, -7, timeZone);

  const { data: profileRows } = user
    ? await supabase.from('profiles').select('full_name').eq('id', user.id).limit(1)
    : { data: [] as Array<{ full_name?: string | null }> };
  const metadata = (user?.user_metadata || {}) as Record<string, unknown>;
  const fullName = String(profileRows?.[0]?.full_name || metadata.full_name || metadata.name || '').trim();
  const welcomeName = fullName ? fullName.split(/\s+/)[0] : String(user?.email || 'there').split('@')[0];

  const [
    readyContacts,
    totalBusinesses,
    sentToday,
    sentLast7,
    initialTemplates,
    followupTemplates,
    totalSent,
    manualReplies,
    allRealReplies,
    followupsSent,
    schedulesEver,
    failedJobs,
    todayReplyRows,
  ] = await Promise.all([
    countRows(supabase, 'businesses', workspace.id, { inFilters: [{ column: 'status', values: CONTACTABLE_STATUSES }], notNull: ['email'] }),
    countRows(supabase, 'businesses', workspace.id),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', start: todayStart, end: generatedAt }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'], dateColumn: 'sent_at', start: last7Start, end: generatedAt }),
    countRows(supabase, 'templates', workspace.id, { filters: [{ column: 'template_type', value: 'initial' }, { column: 'active', value: true }] }),
    countRows(supabase, 'templates', workspace.id, { filters: [{ column: 'template_type', value: 'follow_up' }, { column: 'active', value: true }] }),
    countRows(supabase, 'sent_messages', workspace.id, { inFilters: [{ column: 'status', values: ['sent', 'delivered'] }], notNull: ['provider_message_id'] }),
    countRows(supabase, 'sent_messages', workspace.id, { filters: [{ column: 'delivery_status', value: 'manual_reply_sent' }] }),
    countRows(supabase, 'reply_history', workspace.id, { filters: [{ column: 'is_real_reply', value: true }] }),
    countRows(supabase, 'sent_messages', workspace.id, { filters: [{ column: 'is_follow_up', value: true }], notNull: ['provider_message_id'] }),
    countRows(supabase, 'message_schedules', workspace.id),
    countRows(supabase, 'message_schedules', workspace.id, { filters: [{ column: 'status', value: 'failed' }] }),
    fetchReplyRows(supabase, workspace.id, todayStart, generatedAt),
  ]);
  const todayReplies = calculateReplyMetrics(todayReplyRows.value).realReplies;

  const gmailResponse = await supabase
    .from('gmail_accounts')
    .select('id,email,status,is_paused,health_stage,hard_restriction_active,hard_restricted_until,connection_status,next_eligible_at')
    .eq('workspace_id', workspace.id)
    .order('email', { ascending: true });
  const gmailError = gmailResponse.error ? formatError(gmailResponse.error) : '';
  const gmailSummary = summarizeGmail((gmailResponse.data || []) as GmailRow[]);

  const schedulesResponse = await supabase
    .from('message_schedules')
    .select('id,type,status,run_kind,target_count,processed_count,sent_count,failed_count,updated_at,last_heartbeat_at,stop_requested,last_error')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(30);
  const schedulesError = schedulesResponse.error ? formatError(schedulesResponse.error) : '';
  const allSchedules = (schedulesResponse.data || []) as ScheduleRow[];
  const activeSchedules = allSchedules.filter((row) => ACTIVE_JOB_STATUSES.includes(String(row.status || '')) && !row.stop_requested);
  const currentActivity = allSchedules
    .filter((row) => ACTIVE_JOB_STATUSES.includes(String(row.status || '')) || String(row.status || '') === 'failed')
    .slice(0, 5);
  const queuedContacts = activeSchedules.reduce(
    (total, row) => total + Math.max(0, Number(row.target_count || 0) - Number(row.processed_count || 0)),
    0,
  );

  let dueFollowups: QueryResult<number> = { value: 0 };
  try {
    const { data, error } = await supabase.rpc('get_due_followups', { target_workspace: workspace.id, limit_rows: 100000 });
    if (error) throw error;
    dueFollowups.value = (data || []).length;
  } catch (error) {
    dueFollowups.error = formatError(error);
  }

  let workerReady = false;
  let workerError = '';
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('scout_message_worker_status');
    if (error) throw error;
    const worker = (Array.isArray(data) ? data[0] : data) || {};
    workerReady = worker.ready === true && worker.active === true && String(worker.last_run_status || '') !== 'failed';
    if (!workerReady) workerError = String(worker.last_message || worker.error || 'The central message worker is not running.');
  } catch (error) {
    workerError = formatError(error);
  }

  const queryErrors = [
    readyContacts.error,
    totalBusinesses.error,
    sentToday.error,
    sentLast7.error,
    todayReplyRows.error,
    failedJobs.error,
    gmailError,
    schedulesError,
    dueFollowups.error,
  ].filter(Boolean);
  const attentionCount = gmailSummary.reconnect + gmailSummary.paused + failedJobs.value;

  const setupDone = [
    gmailSummary.total > 0,
    initialTemplates.value > 0,
    followupTemplates.value > 0,
    totalBusinesses.value > 0,
    readyContacts.value > 0,
    totalSent.value > 0,
    allRealReplies.value > 0,
    manualReplies.value > 0,
    followupsSent.value > 0,
    schedulesEver.value > 0,
  ].filter(Boolean).length;

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 1180 }}>
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div className="page-title">
          <h2 style={{ marginBottom: 5 }}>Welcome back, {welcomeName}</h2>
          <p>{workspace.name} · {timeZone}</p>
        </div>
        <DashboardAutoRefresh generatedAt={generatedAt.toISOString()} />
      </div>

      {!workerReady ? (
        <div className="card" style={{ padding: 16, borderColor: 'var(--bad)', background: 'color-mix(in srgb, var(--bad) 7%, var(--surface))' }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div className="actions" style={{ alignItems: 'flex-start', gap: 11 }}>
              <AlertTriangle size={21} style={{ color: 'var(--bad)', flex: '0 0 auto', marginTop: 1 }} />
              <div>
                <strong>Message worker offline</strong>
                <div className="muted" style={{ marginTop: 4 }}>Sending jobs cannot continue until the worker is repaired.</div>
              </div>
            </div>
            <Link href="/settings" className="btn secondary mini">View fix</Link>
          </div>
        </div>
      ) : null}

      {attentionCount > 0 || queryErrors.length > 0 ? (
        <div className="card" style={{ padding: 15 }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div>
              <strong>{attentionCount + queryErrors.length} item{attentionCount + queryErrors.length === 1 ? '' : 's'} need attention</strong>
              <div className="muted" style={{ marginTop: 5, fontSize: 13 }}>
                {[
                  gmailSummary.reconnect ? `${gmailSummary.reconnect} Gmail reconnect${gmailSummary.reconnect === 1 ? '' : 's'}` : '',
                  gmailSummary.paused ? `${gmailSummary.paused} paused Gmail` : '',
                  failedJobs.value ? `${failedJobs.value} failed job${failedJobs.value === 1 ? '' : 's'}` : '',
                  queryErrors.length ? `${queryErrors.length} data check${queryErrors.length === 1 ? '' : 's'}` : '',
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="actions" style={{ gap: 7 }}>
              {gmailSummary.reconnect || gmailSummary.paused ? <Link href="/settings" className="btn secondary mini">Gmail issues</Link> : null}
              {failedJobs.value ? <Link href="/message" className="btn secondary mini">Sending issues</Link> : null}
            </div>
          </div>
        </div>
      ) : workerReady ? (
        <div className="actions" style={{ color: 'var(--ok)', gap: 7, fontSize: 13, fontWeight: 800 }}>
          <CheckCircle2 size={17} /> Scout is working normally
        </div>
      ) : null}

      <div className="grid grid-4">
        <MetricCard
          icon={<Send size={19} />}
          title="Sending"
          primary={`${activeSchedules.length.toLocaleString()} active`}
          secondary={`${queuedContacts.toLocaleString()} queued`}
          href="/message"
          error={schedulesError}
        />
        <MetricCard
          icon={<Mail size={19} />}
          title="Gmail accounts"
          primary={`${gmailSummary.available.toLocaleString()} available`}
          secondary={`${gmailSummary.paused + gmailSummary.reconnect} need action`}
          href="/settings"
          error={gmailError}
        />
        <MetricCard
          icon={<Users size={19} />}
          title="Sent today"
          primary={sentToday.value.toLocaleString()}
          secondary={`${sentLast7.value.toLocaleString()} last 7 days`}
          href="/message"
          error={sentToday.error || sentLast7.error}
        />
        <MetricCard
          icon={<MessageCircle size={19} />}
          title="Replies"
          primary={`${todayReplies.toLocaleString()} today`}
          secondary={`${dueFollowups.value.toLocaleString()} follow-ups due`}
          href="/replies"
          error={todayReplyRows.error || dueFollowups.error}
        />
      </div>

      <div className="grid grid-3">
        <QuickAction icon={<Mail size={17} />} title="Send emails" href="/message" />
        <QuickAction icon={<Search size={17} />} title="Find missing emails" href="/source-scout" />
        <QuickAction icon={<MessageCircle size={17} />} title="Review replies" href="/replies" />
      </div>

      {dueFollowups.value > 0 && !dueFollowups.error ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div>
              <strong>{dueFollowups.value.toLocaleString()} follow-up{dueFollowups.value === 1 ? '' : 's'} ready</strong>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Scout will use the same automatic sender limits and pacing.</div>
            </div>
            <Link href="/message" className="btn">Send follow-ups</Link>
          </div>
        </div>
      ) : null}

      <section>
        <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Current activity</h3>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Active, queued and recently failed jobs only.</div>
          </div>
          <Link href="/message" className="btn secondary mini">View all jobs</Link>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {currentActivity.map((row) => {
            const progress = progressOf(row);
            const label = statusLabel(row);
            const error = friendlyJobError(row.last_error);
            const isActive = ACTIVE_JOB_STATUSES.includes(String(row.status || '')) && !row.stop_requested;
            const isFailed = String(row.status || '') === 'failed';
            return (
              <div className="card" style={{ padding: 16 }} key={row.id}>
                <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="actions" style={{ gap: 8 }}>
                      <strong>{row.type === 'follow_up' ? 'Follow-up outreach' : 'Initial outreach'}</strong>
                      <span className="badge" style={{ color: statusColor(label) }}>{label}</span>
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
          {!currentActivity.length && !schedulesError ? (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <strong>No active or failed jobs</strong>
              <div className="muted" style={{ marginTop: 5 }}>New sending activity will appear here.</div>
            </div>
          ) : null}
          {schedulesError ? <div className="error">Current jobs could not load.</div> : null}
        </div>
      </section>

      <div className="card" style={{ padding: 16 }}>
        <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div>
            <strong>{readyContacts.error ? 'Lead summary unavailable' : `${readyContacts.value.toLocaleString()} contacts ready to email`}</strong>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              {totalBusinesses.error ? 'Open Find Leads to review your contacts.' : `${totalBusinesses.value.toLocaleString()} total contacts in this workspace.`}
            </div>
          </div>
          <Link href="/source-scout" className="btn secondary mini">Open Find Leads</Link>
        </div>
      </div>

      {setupDone < 10 ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="actions" style={{ justifyContent: 'space-between', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <strong>Setup {setupDone} of 10 complete</strong>
              <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', marginTop: 9, maxWidth: 420 }}>
                <div style={{ width: `${setupDone * 10}%`, height: '100%', background: 'var(--ok)', borderRadius: 999 }} />
              </div>
            </div>
            <Link href="/help" className="btn secondary mini">Continue setup</Link>
          </div>
        </div>
      ) : null}

      {workerError && workerReady ? <span style={{ display: 'none' }}>{workerError}</span> : null}
    </div>
  );
}
