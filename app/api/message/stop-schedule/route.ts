export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAppNotification } from '@/lib/notifications';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || body.workspace_id || '').trim();
    const scheduleId = String(body.scheduleId || body.schedule_id || '').trim();
    if (!workspaceId || !scheduleId) return NextResponse.json({ success: false, error: 'Missing workspaceId or scheduleId.' }, { status: 400 });

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('approved', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return NextResponse.json({ success: false, error: 'You are not approved for this workspace.' }, { status: 403 });

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('message_schedules')
      .update({
        stop_requested: true,
        stopped_at: now,
        last_error: 'Stop requested by user.',
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', scheduleId)
      .in('status', ['scheduled', 'due', 'running'])
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: 'No active schedule found to stop.' }, { status: 404 });

    await createAppNotification(supabase as any, {
      workspaceId,
      type: 'job_stopped',
      title: 'Sending job stop requested',
      message: 'Scout will stop the job after the current in-flight recipient finishes.',
      entityType: 'message_schedule',
      entityId: scheduleId,
      raw: { schedule_id: scheduleId },
    });

    return NextResponse.json({ success: true, schedule: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
