export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

async function authorizedWorkspace(request: NextRequest) {
  const input = request.method === 'GET' ? Object.fromEntries(request.nextUrl.searchParams.entries()) : await request.json().catch(() => ({}));
  const workspaceId = String((input as any).workspace_id || (input as any).workspaceId || '');
  if (!workspaceId) throw new Error('workspace_id is required.');
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { data: member } = await session.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).eq('approved', true).maybeSingle();
  if (!member) throw new Error('Workspace access denied.');
  return { workspaceId, input };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await authorizedWorkspace(request);
    const admin = createAdminClient();
    const olderThan = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: templates, error: templateError } = await admin.from('templates').select('id,name,created_at,template_type,raw').eq('workspace_id', workspaceId).eq('active', true).lte('created_at', olderThan).neq('template_type', 'reply').limit(200);
    if (templateError) throw templateError;

    for (const template of templates || []) {
      const [{ count: sentCount, error: sentError }, { count: replyCount, error: replyError }] = await Promise.all([
        admin.from('sent_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('template_id', template.id).eq('status', 'sent'),
        admin.from('reply_history').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('template_id', template.id).eq('is_real_reply', true),
      ]);
      if (sentError || replyError) continue;
      if (Number(sentCount || 0) >= 10000 && Number(replyCount || 0) === 0) {
        await admin.from('template_health_alerts').upsert({
          workspace_id: workspaceId,
          template_id: template.id,
          sent_count: Number(sentCount || 0),
          real_reply_count: 0,
          raw: { template_name: template.name, threshold_days: 3, threshold_sends: 10000, based_on_scout_tracked_replies: true },
        }, { onConflict: 'workspace_id,template_id', ignoreDuplicates: true });
      }
    }

    const { data: alerts, error: alertError } = await admin.from('template_health_alerts').select('id,template_id,sent_count,real_reply_count,alerted_at,raw').eq('workspace_id', workspaceId).is('dismissed_at', null).order('alerted_at', { ascending: false });
    if (alertError) {
      if (String(alertError.message || '').includes('template_health_alerts')) return NextResponse.json({ success: true, alerts: [], migration_required: true });
      throw alertError;
    }
    return NextResponse.json({ success: true, alerts: alerts || [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, input } = await authorizedWorkspace(request);
    const alertId = String((input as any).alert_id || '');
    if (!alertId) throw new Error('alert_id is required.');
    const admin = createAdminClient();
    const { error } = await admin.from('template_health_alerts').update({ dismissed_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', alertId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
