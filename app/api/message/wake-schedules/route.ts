export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { ensureMessageWorker } from '@/lib/message-worker';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
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
    if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('approved', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return NextResponse.json({ success: false, error: 'You do not have access to this workspace.' }, { status: 403 });

    const now = new Date().toISOString();
    const { data: dueRows, error: dueError } = await supabase
      .from('message_schedules')
      .select('id,status,scheduled_for')
      .eq('workspace_id', workspaceId)
      .eq('status', 'scheduled')
      .or('stop_requested.is.null,stop_requested.eq.false')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(1);
    if (dueError) throw dueError;

    const workerSetup = await ensureMessageWorker(request.nextUrl.origin);
    return NextResponse.json({
      success: true,
      accepted: true,
      due: Boolean(dueRows?.length),
      dueScheduleId: dueRows?.[0]?.id || null,
      workerReady: workerSetup.ready,
      warning: workerSetup.ready ? undefined : workerSetup.error,
      executionMode: 'central_worker',
      message: dueRows?.length
        ? workerSetup.ready
          ? 'The due schedule is queued. The central worker will pick it up automatically within about 30 seconds.'
          : 'The schedule is due, but the central worker needs attention.'
        : 'No saved schedules are due right now.',
      workerSetup,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
