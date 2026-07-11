export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';

function getSecret(request: NextRequest, input?: Record<string, unknown>) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return String(
    input?.token ||
      request.nextUrl.searchParams.get('token') ||
      request.headers.get('x-schedule-worker-secret') ||
      bearer ||
      ''
  );
}

function authorized(request: NextRequest, input?: Record<string, unknown>) {
  const expected = process.env.SCHEDULE_WORKER_SECRET || process.env.CRON_SECRET || process.env.RUN_ALL_WORKER_SECRET || '';
  const provided = getSecret(request, input);
  return Boolean(expected && provided === expected);
}

function safeLimit(value: string | number | null | undefined, fallback: number, max: number) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

async function callScheduleRunner(request: NextRequest, input?: Record<string, unknown>) {
  if (!authorized(request, input)) {
    return NextResponse.json({ success: false, error: 'Invalid cron token.' }, { status: 401 });
  }

  const token = getSecret(request, input);
  const workspaceId = String(input?.workspaceId || request.nextUrl.searchParams.get('workspaceId') || '').trim();
  const limit = safeLimit(input?.limit as number | string | undefined || request.nextUrl.searchParams.get('limit'), 1, 3);
  const targetLimit = safeLimit(input?.targetLimit as number | string | undefined || request.nextUrl.searchParams.get('targetLimit'), 25, 50);
  const senderRunLimit = safeLimit(input?.senderRunLimit as number | string | undefined || request.nextUrl.searchParams.get('senderRunLimit'), targetLimit, 50);

  const url = new URL('/api/message/run-schedules', request.nextUrl.origin);
  if (workspaceId) url.searchParams.set('workspaceId', workspaceId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('targetLimit', String(targetLimit));
  url.searchParams.set('senderRunLimit', String(senderRunLimit));
  url.searchParams.set('token', token);

  const response = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  const json = await response.json().catch(() => ({ success: response.ok }));
  return NextResponse.json({
    success: response.ok && json?.success !== false,
    worker: 'run-due',
    chunk: { schedules: limit, emailsPerSchedule: targetLimit, maxPerSenderThisCron: senderRunLimit },
    ...json,
  }, { status: response.ok ? 200 : response.status });
}

export async function GET(request: NextRequest) {
  try {
    return await callScheduleRunner(request);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => ({}));
    return await callScheduleRunner(request, input);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
