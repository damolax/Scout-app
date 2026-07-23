export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const UNFINISHED_STATUSES = ['scheduled', 'due', 'running', 'failed'];

type AnyRow = Record<string, any>;

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function jobReferenceMs(row: AnyRow) {
  const candidates = [row.last_heartbeat_at, row.updated_at, row.scheduled_for, row.created_at];
  for (const value of candidates) {
    const ms = value ? new Date(value).getTime() : 0;
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || body.workspace_id || '').trim();
    if (!workspaceId) {
      return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });
    }

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .limit(1);
    if (memberError) throw memberError;
    if (!member?.length || member[0]?.approved === false) {
      return NextResponse.json({ success: false, error: 'You do not have access to this workspace.' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('message_schedules')
      .select('id,workspace_id,type,status,target_count,processed_count,sent_count,failed_count,skipped_count,scheduled_for,last_heartbeat_at,updated_at,created_at,last_error,stop_requested')
      .eq('workspace_id', workspaceId)
      .in('status', UNFINISHED_STATUSES)
      .or('stop_requested.is.null,stop_requested.eq.false')
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(50);
    if (error) throw error;

    const nowMs = Date.now();
    const jobs = (data || [])
      .filter((row: AnyRow) => {
        const target = Math.max(0, Number(row.target_count || 0));
        const processed = Math.max(0, Number(row.processed_count || 0));
        if (target > 0 && processed >= target) return false;
        const scheduledMs = row.scheduled_for ? new Date(row.scheduled_for).getTime() : 0;
        if (scheduledMs > nowMs) return false;
        const referenceMs = jobReferenceMs(row);
        return referenceMs > 0 && nowMs - referenceMs >= STALE_AFTER_MS;
      })
      .map((row: AnyRow) => ({
        ...row,
        staleForMinutes: Math.max(120, Math.floor((nowMs - jobReferenceMs(row)) / 60000)),
      }));

    return NextResponse.json({
      success: true,
      thresholdMinutes: 120,
      jobs,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
