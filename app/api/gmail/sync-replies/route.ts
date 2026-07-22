export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { createAdminClient } from '@/lib/supabase-admin';
import { formatInboundError, syncGmailInbound } from '@/lib/gmail-inbound-sync';

export async function POST(request: NextRequest) {
  let workspaceId = '';
  let accountId = '';
  try {
    const input = await request.json().catch(() => ({}));
    workspaceId = String(input.workspace_id || input.workspaceId || '');
    accountId = String(input.gmail_account_id || input.accountId || '');
    await requireWorkspaceAccess(workspaceId);
    const maxResults = Number(input.max_results || input.limit || 100);
    const days = Number(input.days || 30);
    const supabase = createAdminClient();
    const result = await syncGmailInbound({ supabase, workspaceId, accountId, maxResults, days, mode: 'replies' });
    return NextResponse.json(result);
  } catch (err) {
    const message = formatInboundError(err);
    try {
      if (workspaceId && accountId) await createAdminClient().from('gmail_accounts').update({ last_reply_sync_status: 'error', last_reply_sync_error: message, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
    } catch {}
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
