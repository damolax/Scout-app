export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function safeQuery<T>(fn: () => any, fallback: T): Promise<T> {
  try {
    const { data, error } = await fn();
    if (error) return fallback;
    return data || fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspaceId') || '').trim();
    if (!workspaceId) return NextResponse.json({ success: false, error: 'workspaceId is required.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('approved', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return NextResponse.json({ success: false, error: 'You are not approved for this workspace.' }, { status: 403 });

    const admin = createAdminClient();
    const schedules = await safeQuery<any[]>(() => admin
      .from('message_schedules')
      .select('id,type,status,run_kind,target_count,processed_count,sent_count,failed_count,skipped_count,scheduled_for,updated_at,stop_requested,last_error')
      .eq('workspace_id', workspaceId)
      .in('status', ['scheduled', 'due', 'running'])
      .order('updated_at', { ascending: false })
      .limit(8), []);

    const sent = await safeQuery<any[]>(() => admin
      .from('sent_messages')
      .select('id,status,to_email,from_email,subject,sent_at,created_at')
      .eq('workspace_id', workspaceId)
      .order('sent_at', { ascending: false })
      .limit(8), []);

    const research = await safeQuery<any[]>(() => admin
      .from('email_research_jobs')
      .select('id,business_id,status,attempts,last_error,updated_at,created_at,finished_at')
      .eq('workspace_id', workspaceId)
      .in('status', ['queued', 'running', 'done', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(8), []);

    const logs = await safeQuery<any[]>(() => admin
      .from('activity_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(6), []);

    return NextResponse.json({
      success: true,
      schedules,
      recentSent: sent,
      researchJobs: research,
      logs,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
