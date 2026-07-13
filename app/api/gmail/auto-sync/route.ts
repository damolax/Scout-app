export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { formatInboundError, syncGmailInbound } from '@/lib/gmail-inbound-sync';
import { createAppNotification } from '@/lib/notifications';

type AnyRecord = Record<string, any>;

type AccountResult = {
  accountId: string;
  email: string;
  scanned: number;
  saved: number;
  realReplies: number;
  autoReplies: number;
  noInbox: number;
  blocked: number;
  bounced: number;
  limitNotices: number;
  error?: string;
};

function num(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const input = await request.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || input.workspaceId || '');
    if (!workspaceId) throw new Error('workspaceId is required.');

    const maxResults = Math.max(5, Math.min(num(input.max_results || input.maxResults, 25), 75));
    const bounceMaxResults = Math.max(5, Math.min(num(input.bounce_max_results || input.bounceMaxResults, 15), 50));
    const days = Math.max(1, Math.min(num(input.days, 14), 30));
    const accountLimit = Math.max(1, Math.min(num(input.account_limit || input.accountLimit, 50), 50));

    const supabase = createAdminClient();
    const { data: accounts, error: accountsError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['connected', 'ready'])
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(accountLimit);

    if (accountsError) throw accountsError;

    const results: AccountResult[] = [];
    const rows = Array.isArray(accounts) ? (accounts as AnyRecord[]) : [];

    for (const account of rows) {
      const accountId = String(account.id || '');
      const email = String(account.email || 'Gmail account');
      if (!accountId) continue;

      const row: AccountResult = {
        accountId,
        email,
        scanned: 0,
        saved: 0,
        realReplies: 0,
        autoReplies: 0,
        noInbox: 0,
        blocked: 0,
        bounced: 0,
        limitNotices: 0
      };

      try {
        const replies = await syncGmailInbound({
          supabase,
          workspaceId,
          accountId,
          maxResults,
          days,
          mode: 'replies'
        });
        row.scanned += Number(replies.scanned || 0);
        row.saved += Number(replies.saved || 0);
        row.realReplies += Number(replies.realReplies || 0);
        row.autoReplies += Number(replies.autoReplies || 0);
        row.noInbox += Number(replies.noInbox || 0);
        row.blocked += Number(replies.blocked || 0);
        row.bounced += Number(replies.bounced || 0);
        row.limitNotices += Number(replies.limitNotices || 0);

        const bounces = await syncGmailInbound({
          supabase,
          workspaceId,
          accountId,
          maxResults: bounceMaxResults,
          days,
          mode: 'bounces'
        });
        row.scanned += Number(bounces.scanned || 0);
        row.saved += Number(bounces.saved || 0);
        row.realReplies += Number(bounces.realReplies || 0);
        row.autoReplies += Number(bounces.autoReplies || 0);
        row.noInbox += Number(bounces.noInbox || 0);
        row.blocked += Number(bounces.blocked || 0);
        row.bounced += Number(bounces.bounced || 0);
        row.limitNotices += Number(bounces.limitNotices || 0);
      } catch (err) {
        row.error = formatInboundError(err);
        await createAppNotification(supabase, {
          workspaceId,
          type: 'gmail_sync_failed',
          title: `Gmail sync issue: ${email}`,
          message: row.error.slice(0, 320),
          entityType: 'gmail_account',
          entityId: accountId,
          raw: { source: 'app_open_auto_sync', email, error: row.error }
        });
      }

      results.push(row);
    }

    const totals = results.reduce((acc, row) => {
      acc.scanned += row.scanned;
      acc.saved += row.saved;
      acc.realReplies += row.realReplies;
      acc.autoReplies += row.autoReplies;
      acc.noInbox += row.noInbox;
      acc.blocked += row.blocked;
      acc.bounced += row.bounced;
      acc.limitNotices += row.limitNotices;
      if (row.error) acc.errors += 1;
      return acc;
    }, { scanned: 0, saved: 0, realReplies: 0, autoReplies: 0, noInbox: 0, blocked: 0, bounced: 0, limitNotices: 0, errors: 0 });

    return NextResponse.json({
      success: true,
      source: 'app_open_auto_sync',
      accountsChecked: results.length,
      totals,
      results,
      durationMs: Date.now() - startedAt
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: formatInboundError(err) }, { status: 400 });
  }
}
