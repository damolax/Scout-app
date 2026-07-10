export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient as createServerClient } from '@/lib/supabase-server';
import { formatInboundError, syncGmailInbound } from '@/lib/gmail-inbound-sync';
import { createAppNotification } from '@/lib/notifications';

type AnyRow = Record<string, any>;
type StepStatus = 'success' | 'skipped' | 'failed';

type WorkerStep = {
  key: string;
  label: string;
  status: StepStatus;
  startedAt: string;
  finishedAt: string;
  metrics?: Record<string, unknown>;
  error?: string;
};

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

function nowIso() {
  return new Date().toISOString();
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function workerSecret() {
  return process.env.RUN_ALL_WORKER_SECRET || process.env.CRON_SECRET || process.env.SCHEDULE_WORKER_SECRET || process.env.AUTO_SCOUT_WORKER_SECRET || '';
}

function providedSecretFromRequest(request: NextRequest, body?: Record<string, unknown>) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return String(
    body?.token ||
    request.nextUrl.searchParams.get('token') ||
    request.headers.get('x-run-all-worker-secret') ||
    request.headers.get('x-cron-secret') ||
    bearer ||
    ''
  );
}

function boolOption(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readOptions(request: NextRequest, body: AnyRow) {
  const p = request.nextUrl.searchParams;
  const pick = (key: string) => body[key] ?? body[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] ?? p.get(key);
  return {
    workspaceId: String(pick('workspaceId') || body.workspace_id || process.env.SCOUT_DEFAULT_WORKSPACE_ID || process.env.NEXT_PUBLIC_SCOUT_DEFAULT_WORKSPACE_ID || DEFAULT_WORKSPACE_ID).trim(),
    includeReplies: boolOption(pick('includeReplies'), true),
    includeBounces: boolOption(pick('includeBounces'), true),
    includeSchedules: boolOption(pick('includeSchedules'), true),
    includeAutoScout: boolOption(pick('includeAutoScout'), true),
    includeSeedTest: boolOption(pick('includeSeedTest'), false),
    includeRepairReady: boolOption(pick('includeRepairReady'), true),
    replyDays: numberOption(pick('replyDays'), 90, 1, 90),
    replyLimit: numberOption(pick('replyLimit'), 500, 1, 500),
    scheduleLimit: numberOption(pick('scheduleLimit'), 3, 1, 3),
    autoScoutCycles: numberOption(pick('autoScoutCycles'), 5, 1, 25),
    autoScoutBatchSize: numberOption(pick('autoScoutBatchSize'), 100, 1, 500),
    autoScoutConcurrency: numberOption(pick('autoScoutConcurrency'), 12, 1, 50),
    autoScoutEnqueueLimit: numberOption(pick('autoScoutEnqueueLimit'), 2500, 0, 50000)
  };
}

async function authorize(request: NextRequest, body: AnyRow, workspaceId: string) {
  const required = workerSecret();
  const supplied = providedSecretFromRequest(request, body);
  const isVercelCron = (request.headers.get('user-agent') || '').toLowerCase().includes('vercel-cron');
  if (required && (supplied === required || isVercelCron)) return { ok: true, method: isVercelCron ? 'vercel-cron' : 'secret' };

  const userClient = await createServerClient();
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return { ok: false, method: 'none', error: required ? 'Unauthorized. Missing or invalid worker token.' : 'Not signed in.' };

  const { data: member, error: memberError } = await userClient
    .from('workspace_members')
    .select('workspace_id, approved')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .eq('approved', true)
    .maybeSingle();
  if (memberError || !member) return { ok: false, method: 'user', error: memberError?.message || 'You are not approved for this workspace.' };
  return { ok: true, method: 'user' };
}

async function step(key: string, label: string, fn: () => Promise<Record<string, unknown> | undefined>): Promise<WorkerStep> {
  const startedAt = nowIso();
  try {
    const metrics = await fn();
    return { key, label, status: 'success', startedAt, finishedAt: nowIso(), metrics: metrics || {} };
  } catch (error) {
    return { key, label, status: 'failed', startedAt, finishedAt: nowIso(), error: formatError(error) };
  }
}

function skippedStep(key: string, label: string, reason: string): WorkerStep {
  const at = nowIso();
  return { key, label, status: 'skipped', startedAt: at, finishedAt: at, metrics: { reason } };
}

async function loadConnectedAccounts(supabase: ReturnType<typeof createAdminClient>, workspaceId: string) {
  const { data, error } = await supabase
    .from('gmail_accounts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('status', ['connected', 'ready', 'limit_hit'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter((account: AnyRow) => account.access_token || account.refresh_token);
}

async function syncModeForAllAccounts(workspaceId: string, mode: 'replies' | 'bounces', limit: number, days: number) {
  const supabase = createAdminClient();
  const accounts = await loadConnectedAccounts(supabase, workspaceId);
  if (!accounts.length) return { accounts: 0, scanned: 0, saved: 0, matched: 0, realReplies: 0, autoReplies: 0, noInbox: 0, blocked: 0, bounced: 0, limitNotices: 0, temporary: 0, errors: [] };

  const totals: Record<string, any> = { accounts: accounts.length, scanned: 0, saved: 0, matched: 0, realReplies: 0, autoReplies: 0, noInbox: 0, blocked: 0, bounced: 0, limitNotices: 0, temporary: 0, errors: [] as Array<Record<string, string>> };
  for (const account of accounts) {
    try {
      const result = await syncGmailInbound({ supabase, workspaceId, accountId: String(account.id), maxResults: limit, days, mode });
      totals.scanned += Number(result.scanned || 0);
      totals.saved += Number(result.saved || 0);
      totals.matched += Number(result.matched || 0);
      totals.realReplies += Number(result.realReplies || 0);
      totals.autoReplies += Number(result.autoReplies || 0);
      totals.noInbox += Number(result.noInbox || 0);
      totals.blocked += Number(result.blocked || 0);
      totals.bounced += Number(result.bounced || 0);
      totals.limitNotices += Number(result.limitNotices || 0);
      totals.temporary += Number(result.temporary || 0);
    } catch (error) {
      totals.errors.push({ account: String(account.email || account.id), error: formatInboundError(error) });
    }
  }
  return totals;
}

async function repairReady(workspaceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('mark_ready_emails_and_pending_no_email', { target_workspace: workspaceId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { ready: Number(row?.ready_count || 0), pendingNoEmail: Number(row?.pending_count || 0) };
}

async function callInternalJson(request: NextRequest, path: string, body: Record<string, unknown>) {
  const secret = workerSecret();
  const response = await fetch(new URL(path, request.nextUrl.origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-cron-secret': secret, 'x-run-all-worker-secret': secret, authorization: `Bearer ${secret}` } : {})
    },
    body: JSON.stringify({ ...body, ...(secret ? { token: secret } : {}) }),
    cache: 'no-store'
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.success === false) throw new Error(json?.error || `Internal ${path} failed with HTTP ${response.status}`);
  return json as Record<string, unknown>;
}

async function runAll(request: NextRequest, body: AnyRow) {
  const startedAt = nowIso();
  const options = readOptions(request, body);
  const auth = await authorize(request, body, options.workspaceId);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized.' }, { status: 401 });
  }

  const steps: WorkerStep[] = [];
  if (options.includeBounces) {
    steps.push(await step('sync_bounces', 'Sync bounces, no-inbox and blocked notices', () => syncModeForAllAccounts(options.workspaceId, 'bounces', options.replyLimit, options.replyDays)));
  } else {
    steps.push(skippedStep('sync_bounces', 'Sync bounces, no-inbox and blocked notices', 'Disabled for this run.'));
  }

  if (options.includeReplies) {
    steps.push(await step('sync_replies', 'Sync real replies and auto-responders', () => syncModeForAllAccounts(options.workspaceId, 'replies', options.replyLimit, options.replyDays)));
  } else {
    steps.push(skippedStep('sync_replies', 'Sync real replies and auto-responders', 'Disabled for this run.'));
  }

  if (options.includeRepairReady) {
    steps.push(await step('repair_ready', 'Repair Ready/Pending email statuses', () => repairReady(options.workspaceId)));
  } else {
    steps.push(skippedStep('repair_ready', 'Repair Ready/Pending email statuses', 'Disabled for this run.'));
  }

  if (options.includeSchedules) {
    steps.push(await step('run_schedules', 'Run due initial and follow-up schedules', () => callInternalJson(request, '/api/message/run-schedules', { limit: options.scheduleLimit })));
  } else {
    steps.push(skippedStep('run_schedules', 'Run due initial and follow-up schedules', 'Disabled for this run.'));
  }

  if (options.includeAutoScout) {
    steps.push(await step('auto_scout', 'Run Auto Scout email research worker', () => callInternalJson(request, '/api/research/run-worker', {
      workspaceId: options.workspaceId,
      cycles: options.autoScoutCycles,
      batchSize: options.autoScoutBatchSize,
      concurrency: options.autoScoutConcurrency,
      enqueueLimit: options.autoScoutEnqueueLimit,
      autoEnqueue: true
    })));
  } else {
    steps.push(skippedStep('auto_scout', 'Run Auto Scout email research worker', 'Disabled for this run.'));
  }

  if (options.includeSeedTest) {
    steps.push(await step('seed_test', 'Run deliverability seed inbox test', () => callInternalJson(request, '/api/gmail/seed-test/run', { workspace_id: options.workspaceId })));
  } else {
    steps.push(skippedStep('seed_test', 'Run deliverability seed inbox test', 'Disabled by default to avoid unnecessary seed emails.'));
  }

  const failed = steps.filter((s) => s.status === 'failed').length;
  const finishedAt = nowIso();
  const payload = {
    success: failed === 0,
    workspaceId: options.workspaceId,
    authorizedBy: auth.method,
    startedAt,
    finishedAt,
    failed,
    completed: steps.filter((s) => s.status === 'success').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    options,
    steps
  };

  try {
    const supabase = createAdminClient();
    await supabase.from('activity_logs').insert({
      workspace_id: options.workspaceId,
      type: failed ? 'worker_warning' : 'worker_run',
      message: failed ? `Autopilot finished with ${failed} failed step(s).` : 'Autopilot worker run completed.',
      raw: payload
    });
    await createAppNotification(supabase as any, {
      workspaceId: options.workspaceId,
      type: failed ? 'worker_warning' : 'worker_completed',
      title: failed ? `Autopilot finished with ${failed} failed step(s)` : 'Autopilot completed',
      message: `Completed ${payload.completed}, skipped ${payload.skipped}, failed ${payload.failed}.`,
      entityType: 'worker_run',
      entityId: `${startedAt}-${finishedAt}`,
      raw: payload
    });
  } catch {
    // Logging should never make the worker fail.
  }

  return NextResponse.json(payload, { status: failed ? 207 : 200 });
}

export async function GET(request: NextRequest) {
  try {
    return await runAll(request, {});
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return await runAll(request, body as AnyRow);
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
