export const runtime = 'nodejs';

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { buildMimeMessage, appendSignatureToText } from '@/lib/email-signature';
import { finalizeSingleSenderSlot, reserveSingleSenderSlot } from '@/lib/sender-capacity-server';

function b64url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function normalizeEmail(value: unknown) {
  const raw = String(value || '').toLowerCase().replace(/<([^>]+)>/g, ' $1 ');
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] || '';
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

async function sendReplyWithGmail(accessToken: string, from: string, to: string, subject: string, body: string, threadId?: string | null, identity?: Record<string, unknown>) {
  const normalizedSubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
  const message = buildMimeMessage({ from, to, subject: normalizedSubject, body, identity });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(message.raw), ...(threadId ? { threadId } : {}) })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = json?.error?.message || json?.error || `Gmail reply failed with HTTP ${response.status}`;
    const err = new Error(msg) as Error & { status?: number; payload?: unknown; limitHit?: boolean; blocked?: boolean };
    err.status = response.status;
    err.payload = json;
    err.limitHit = looksLikeLimit(msg, response.status);
    err.blocked = looksLikeMessageBlocked(msg, response.status);
    throw err;
  }
  return json as { id?: string; threadId?: string; labelIds?: string[] };
}

async function authorizeWorkspace(workspaceId: string) {
  const session = await createClient();
  const { data: { user }, error: userError } = await session.auth.getUser();
  if (userError || !user) return { error: NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 }) };
  const { data: member, error: memberError } = await session
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .eq('approved', true)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return { error: NextResponse.json({ success: false, error: 'You do not have access to this Scout workspace.' }, { status: 403 }) };
  return { user };
}

export async function POST(request: NextRequest) {
  let reservationId: string | null = null;
  let reservationAdmin: ReturnType<typeof createAdminClient> | null = null;
  try {
    const input = await request.json();
    const workspaceId = String(input.workspace_id || '');
    const businessId = String(input.business_id || '');
    const requestedAccountId = String(input.gmail_account_id || '');
    const templateId = String(input.template_id || input.templateId || '').trim() || null;
    const to = normalizeEmail(input.to || input.email || '');
    const subject = String(input.subject || '').trim();
    const body = String(input.body || input.message || '').trim();
    const inputThreadId = String(input.gmail_thread_id || input.thread_id || '').trim() || null;
    if (!workspaceId || !businessId) throw new Error('workspace_id and business_id are required.');
    if (!to || !subject || !body) throw new Error('to, subject, and body are required.');

    const authorization = await authorizeWorkspace(workspaceId);
    if ('error' in authorization) return authorization.error;

    const supabase = createAdminClient();
    reservationAdmin = supabase;
    const { data: latestSent, error: latestSentError } = await supabase
      .from('sent_messages')
      .select('id,gmail_account_id,gmail_thread_id,subject,to_email,from_email,sent_at')
      .eq('workspace_id', workspaceId)
      .eq('business_id', businessId)
      .not('gmail_account_id', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSentError) throw latestSentError;
    if (!latestSent?.gmail_account_id) throw new Error('Scout could not find the Gmail account that sent the original message to this business. Reply from Gmail for now.');
    if (requestedAccountId && requestedAccountId !== latestSent.gmail_account_id) throw new Error('For safety, Scout replies to this business only with the same Gmail account that sent the original message.');
    const accountId = String(latestSent.gmail_account_id);
    const threadId = inputThreadId || String(latestSent.gmail_thread_id || '') || null;

    const [{ data: account, error: accountError }, { data: business, error: businessError }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single(),
      supabase.from('businesses').select('id,email,name,status').eq('workspace_id', workspaceId).eq('id', businessId).single(),
      supabase.from('workspaces').select('id,timezone').eq('id', workspaceId).single(),
    ]);
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail account not found.');
    if (businessError || !business) throw new Error(businessError?.message || 'Business not found.');
    if (workspaceError || !workspace) throw new Error(workspaceError?.message || 'Scout workspace not found.');

    const pauseUntil = account.paused_until ? new Date(account.paused_until).getTime() : 0;
    const providerStatus = String(account.status || '').toLowerCase();
    if (['limit_hit', 'sender_limited'].includes(providerStatus) && pauseUntil && pauseUntil <= Date.now()) {
      const { data: recovered } = await supabase.from('gmail_accounts').update({
        status: 'connected',
        is_paused: false,
        paused_reason: null,
        health_status: 'recovering',
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId).eq('id', accountId).select('*').single();
      if (recovered) Object.assign(account, recovered);
    }
    if (account.status && !['connected', 'ready'].includes(String(account.status))) throw new Error(`Sender is not connected. Current status: ${account.status}`);
    if (account.is_paused === true || (account.paused_until && new Date(account.paused_until).getTime() > Date.now())) throw new Error('This sender is paused. Open Settings to see the reason.');

    const reservation = await reserveSingleSenderSlot(supabase, {
      workspaceId,
      account,
      runId: randomUUID(),
      batchId: `manual_reply_${businessId}`,
      runLimit: 1,
      timezone: String(workspace.timezone || 'UTC'),
    });
    reservationId = reservation.id;
    if (!reservation.allowed) {
      return NextResponse.json({
        success: false,
        code: 'safe_capacity_reached',
        error: 'This sender has no safe sending capacity remaining today.',
        capacity_reason: reservation.reason,
      }, { status: 409 });
    }

    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('Access token expired and no refresh token is stored. Reconnect Gmail.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
    }

    try {
      let result;
      try {
        result = await sendReplyWithGmail(accessToken, String(account.email), to, subject, body, threadId, account);
      } catch (initialError) {
        const first = initialError as Error & { status?: number };
        if (first.status !== 401 || !account.refresh_token) throw initialError;
        const refreshed = await refreshAccessToken(String(account.refresh_token));
        accessToken = refreshed.access_token;
        await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
        result = await sendReplyWithGmail(accessToken, String(account.email), to, subject, body, threadId, account);
      }

      const sentAt = new Date().toISOString();
      const { error: sentError } = await supabase.from('sent_messages').insert({
        workspace_id: workspaceId,
        business_id: businessId,
        gmail_account_id: accountId,
        template_id: templateId,
        to_email: to,
        from_email: String(account.email),
        subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`,
        body: appendSignatureToText(body, account),
        provider_message_id: result.id || null,
        gmail_thread_id: result.threadId || threadId,
        status: 'sent',
        delivery_status: 'manual_reply_sent',
        is_follow_up: true,
        sent_at: sentAt,
        raw: { source: 'business_manual_reply', schedule_id: reservation.runId, reservation_id: reservationId, reply_template_id: templateId, sending_mode: account.sending_mode || 'normal', gmail: result },
      });
      await supabase.from('businesses').update({ last_manual_reply_at: sentAt, updated_at: sentAt }).eq('workspace_id', workspaceId).eq('id', businessId);
      await supabase.from('gmail_accounts').update({
        last_successful_send_at: sentAt,
        sent_today: Number(account.sent_today || 0) + 1,
        last_error: sentError ? `Reply sent but history save failed: ${sentError.message}` : null,
        updated_at: sentAt,
      }).eq('workspace_id', workspaceId).eq('id', accountId);
      await finalizeSingleSenderSlot(supabase, reservationId, true, sentError?.message);
      reservationId = null;
      return NextResponse.json({ success: true, persisted: !sentError, persistence_error: sentError?.message || null, gmailMessageId: result.id || '', gmailThreadId: result.threadId || threadId || '' });
    } catch (sendErr) {
      const err = sendErr as Error & { status?: number; payload?: unknown; limitHit?: boolean; blocked?: boolean };
      await finalizeSingleSenderSlot(supabase, reservationId, false, err.message);
      reservationId = null;
      if (err.limitHit) {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('gmail_accounts').update({
          status: 'limit_hit',
          is_paused: true,
          paused_reason: err.message,
          paused_until: until,
          health_status: 'sender_limited',
          provider_limit_count: Number(account.provider_limit_count || 0) + 1,
          last_provider_limit_at: new Date().toISOString(),
          last_error: err.message,
          updated_at: new Date().toISOString(),
        }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, code: 'provider_limit_hit', error: err.message, senderPausedUntil: until }, { status: 429 });
      }
      if (err.blocked) {
        await supabase.from('gmail_accounts').update({ health_status: 'at_risk', last_error: err.message, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, code: 'message_blocked', error: err.message }, { status: err.status || 403 });
      }
      throw err;
    }
  } catch (err) {
    if (reservationAdmin && reservationId) await finalizeSingleSenderSlot(reservationAdmin, reservationId, false, formatError(err));
    return NextResponse.json({ success: false, error: formatError(err) }, { status: 400 });
  }
}
