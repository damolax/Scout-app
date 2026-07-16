export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { formatInboundError, syncGmailInbound } from '@/lib/gmail-inbound-sync';
import { featureFlags } from '@/lib/feature-flags';
import { requireWorkspaceAccess, workspaceAccessStatus } from '@/lib/workspace-access-server';

export async function POST(request: NextRequest) {
  if (!featureFlags.gmailReplySync) {
    return NextResponse.json({ success: false, disabled: true, error: 'Automatic Gmail reply reading is temporarily disabled while Scout completes send-only Google verification. Read and reply in Gmail for now.' }, { status: 403 });
  }
  try {
    const input = await request.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || input.workspaceId || '');
    const accountId = String(input.gmail_account_id || input.accountId || '');
    const maxResults = Number(input.max_results || input.limit || 100);
    const days = Number(input.days || 30);
    await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();
    const result = await syncGmailInbound({ supabase, workspaceId, accountId, maxResults, days, mode: 'bounces' });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ success: false, error: formatInboundError(err) }, { status: workspaceAccessStatus(err) });
  }
}
