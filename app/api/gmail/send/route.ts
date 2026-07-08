export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function b64url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function looksLikeLimit(message: string, status: number) {
  const text = message.toLowerCase();
  return status === 429 || text.includes('rate limit') || text.includes('daily') || text.includes('quota') || text.includes('user-rate') || text.includes('limit exceeded');
}

function looksLikeMessageBlocked(message: string, status: number) {
  const text = message.toLowerCase();
  return status === 403 || text.includes('message blocked') || text.includes('blocked') || text.includes('policy') || text.includes('spam') || text.includes('rejected');
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Vercel.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Token refresh failed with HTTP ${response.status}`);
  return { access_token: String(json.access_token || ''), expires_in: Number(json.expires_in || 3600) };
}

async function sendWithGmail(accessToken: string, from: string, to: string, subject: string, body: string) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body
  ];
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(lines.join('\r\n')) })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = json?.error?.message || json?.error || `Gmail send failed with HTTP ${response.status}`;
    const err = new Error(msg) as Error & { status?: number; payload?: unknown; limitHit?: boolean };
    err.status = response.status;
    err.payload = json;
    err.limitHit = looksLikeLimit(msg, response.status);
    (err as Error & { blocked?: boolean }).blocked = looksLikeMessageBlocked(msg, response.status);
    throw err;
  }
  return json as { id?: string; threadId?: string; labelIds?: string[] };
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    const workspaceId = String(input.workspace_id || '');
    const accountId = String(input.gmail_account_id || '');
    const to = String(input.to || input.email || '').trim();
    const subject = String(input.subject || '').trim();
    const body = String(input.body || input.message || '').trim();
    const dryRun = Boolean(input.dryRun || input.dry_run);
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');
    if (!to || !subject || !body) throw new Error('to, subject, and body are required.');

    const supabase = createAdminClient();
    const { data: account, error: accountError } = await supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single();
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail sender account not found.');
    if (account.status && !['connected', 'ready'].includes(String(account.status))) throw new Error(`Sender is not connected. Current status: ${account.status}`);
    if (!account.refresh_token && !account.access_token) throw new Error('Sender has no Gmail OAuth token. Reconnect Gmail in Settings.');

    if (dryRun) {
      return NextResponse.json({ success: true, results: [{ status: 'dry_run', gmailMessageId: '', gmailThreadId: '', reason: 'Dry run only' }] });
    }

    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('Access token expired and no refresh token is stored. Reconnect Gmail.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
    }

    try {
      const result = await sendWithGmail(accessToken, String(account.email), to, subject, body);
      return NextResponse.json({ success: true, access_token: accessToken, results: [{ status: 'sent', gmailMessageId: result.id || '', gmailThreadId: result.threadId || '', raw: result }] });
    } catch (sendErr) {
      const err = sendErr as Error & { status?: number; payload?: unknown; limitHit?: boolean; blocked?: boolean };
      if (err.status === 401 && account.refresh_token) {
        const refreshed = await refreshAccessToken(String(account.refresh_token));
        accessToken = refreshed.access_token;
        await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
        const result = await sendWithGmail(accessToken, String(account.email), to, subject, body);
        return NextResponse.json({ success: true, access_token: accessToken, results: [{ status: 'sent', gmailMessageId: result.id || '', gmailThreadId: result.threadId || '', raw: result }] });
      }
      if (err.limitHit) {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('gmail_accounts').update({ status: 'limit_hit', paused_until: until, last_error: err.message }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, error: err.message, senderPausedUntil: until, results: [{ status: 'limit_hit', reason: err.message }] }, { status: 429 });
      }
      if (err.blocked) {
        await supabase.from('gmail_accounts').update({ last_error: err.message }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, error: err.message, code: 'message_blocked', results: [{ status: 'message_blocked', code: 'message_blocked', reason: err.message }] }, { status: err.status || 403 });
      }
      throw err;
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: formatError(err), results: [{ status: 'failed', reason: formatError(err) }] }, { status: 400 });
  }
}
