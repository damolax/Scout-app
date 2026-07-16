export const runtime = 'nodejs';
export const maxDuration = 300;

import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { appendSignatureToText, buildMimeMessage, EmailAttachment } from '@/lib/email-signature';
import { businessIdentityKeys } from '@/lib/normalize';
import { featureFlags } from '@/lib/feature-flags';
import { finalizeSingleSenderSlot, reserveSingleSenderSlot } from '@/lib/sender-capacity-server';
import { nextDelayMs } from '@/lib/sending-safety';
import { acquireDirectSenderLane, releaseDirectSenderLane } from '@/lib/scale-guard-server';

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

function safeFilename(value: unknown) {
  return String(value || 'attachment').replace(/[\r\n"\\]+/g, ' ').trim().slice(0, 180) || 'attachment';
}

async function prepareAttachments(items: unknown): Promise<EmailAttachment[]> {
  if (!Array.isArray(items)) return [];
  const selected = items.slice(0, 5);
  const attachments: EmailAttachment[] = [];
  let totalBytes = 0;
  for (const item of selected) {
    const row = (item || {}) as Record<string, unknown>;
    const url = String(row.public_url || row.url || '').trim();
    if (!url) continue;
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    const response = await fetch(parsed.toString());
    if (!response.ok) throw new Error(`Attachment download failed for ${safeFilename(row.name || row.filename)} with HTTP ${response.status}`);
    const contentType = String(row.mime_type || row.mimeType || response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    totalBytes += buffer.length;
    if (buffer.length > 10 * 1024 * 1024) throw new Error(`${safeFilename(row.name || row.filename)} is over 10 MB.`);
    if (totalBytes > 18 * 1024 * 1024) throw new Error('Attachments are too large together. Keep total attachments under about 18 MB.');
    attachments.push({
      filename: safeFilename(row.filename || row.name || parsed.pathname.split('/').pop() || 'attachment'),
      mimeType: contentType,
      contentBase64: buffer.toString('base64'),
      sizeBytes: buffer.length,
    });
  }
  return attachments;
}

async function pauseSenderForLimit(supabase: ReturnType<typeof createAdminClient>, workspaceId: string, accountId: string, reason: string, until: string) {
  const rich = await supabase.from('gmail_accounts').update({
    status: 'limit_hit',
    paused_until: until,
    is_paused: true,
    paused_reason: reason,
    last_error: reason,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('id', accountId);
  if (rich.error) {
    await supabase.from('gmail_accounts').update({
      status: 'limit_hit',
      paused_until: until,
      last_error: reason,
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('id', accountId);
  }
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

async function sendWithGmail(accessToken: string, from: string, to: string, subject: string, body: string, identity?: Record<string, unknown>, attachments?: EmailAttachment[]) {
  const message = buildMimeMessage({ from, to, subject, body, identity, attachments });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(message.raw) })
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

function stableRunId(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  if (!value) return randomUUID();
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function checkTeamOwnership(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  businessId: string,
) {
  if (!businessId) return { allowed: true, business: null as Record<string, any> | null };
  const { data: business, error } = await supabase
    .from('businesses')
    .select('id,normalized_key,email,domain,website,phone,name')
    .eq('workspace_id', workspaceId)
    .eq('id', businessId)
    .maybeSingle();
  if (error) throw error;
  if (!business) throw new Error('Business was not found in this workspace.');
  const keys = businessIdentityKeys(business as any);
  if (!keys.length) return { allowed: true, business };
  const { data: blocked, error: guardError } = await supabase.rpc('team_duplicate_keys', {
    input_keys: keys,
    target_workspace: workspaceId,
  });
  if (guardError) throw guardError;
  return { allowed: !(blocked || []).length, business };
}

export async function POST(request: NextRequest) {
  let reservationId: string | null = null;
  let reservationAdmin: ReturnType<typeof createAdminClient> | null = null;
  let senderLaneToken: string | null = null;
  let senderLaneAdmin: ReturnType<typeof createAdminClient> | null = null;
  try {
    if (!featureFlags.gmailSend) {
      return NextResponse.json({ success: false, error: 'Gmail sending is temporarily unavailable.' }, { status: 503 });
    }

    const input = await request.json();
    const workspaceId = String(input.workspace_id || '').trim();
    const accountId = String(input.gmail_account_id || '').trim();
    const businessId = String(input.business_id || '').trim();
    const templateId = String(input.template_id || input.templateId || '').trim() || null;
    const batchId = String(input.batch_id || input.batchId || '').trim() || null;
    const to = String(input.to || input.email || '').trim();
    const subject = String(input.subject || '').trim();
    const body = String(input.body || input.message || '').trim();
    const dryRun = Boolean(input.dryRun || input.dry_run);
    const isFollowUp = Boolean(input.is_follow_up || input.isFollowUp);
    const runLimit = Number(input.run_limit || input.runLimit || 0) || undefined;
    const runId = stableRunId(String(input.run_id || input.runId || batchId || ''));
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');
    if (!to || !subject || !body) throw new Error('to, subject, and body are required.');

    const authorization = await authorizeWorkspace(workspaceId);
    if ('error' in authorization) return authorization.error;

    const supabase = createAdminClient();
    reservationAdmin = supabase;
    const [{ data: account, error: accountError }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single(),
      supabase.from('workspaces').select('id,timezone').eq('id', workspaceId).single(),
    ]);
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail sender account not found.');
    if (workspaceError || !workspace) throw new Error(workspaceError?.message || 'Scout workspace not found.');

    const pauseUntil = account.paused_until ? new Date(account.paused_until).getTime() : 0;
    const providerStatus = String(account.status || '').toLowerCase();
    if (['limit_hit', 'sender_limited'].includes(providerStatus) && pauseUntil && pauseUntil <= Date.now()) {
      const now = new Date().toISOString();
      const { data: recovered } = await supabase.from('gmail_accounts').update({
        status: 'connected',
        is_paused: false,
        paused_reason: null,
        health_status: 'recovering',
        last_error: null,
        updated_at: now,
      }).eq('workspace_id', workspaceId).eq('id', accountId).select('*').single();
      if (recovered) Object.assign(account, recovered);
    }
    if (account.status && !['connected', 'ready'].includes(String(account.status))) throw new Error(`Sender is not connected. Current status: ${account.status}`);
    if (account.is_paused === true || (account.paused_until && new Date(account.paused_until).getTime() > Date.now())) throw new Error('This sender is paused. Open Settings to see the reason.');
    if (!account.refresh_token && !account.access_token) throw new Error('Sender has no Gmail OAuth token. Reconnect Gmail in Settings.');

    const ownership = await checkTeamOwnership(supabase, workspaceId, businessId);
    if (!ownership.allowed) {
      return NextResponse.json({
        success: false,
        code: 'team_duplicate_blocked',
        error: 'This business is owned by another Scout team member or is retained in the team duplicate registry.',
        results: [{ status: 'team_duplicate_blocked', code: 'team_duplicate_blocked', reason: 'Team duplicate protection blocked this send.' }],
      }, { status: 409 });
    }

    const attachments = await prepareAttachments(input.attachments);
    if (dryRun) {
      return NextResponse.json({ success: true, persisted: false, results: [{ status: 'dry_run', gmailMessageId: '', gmailThreadId: '', reason: attachments.length ? `Dry run only · ${attachments.length} attachment(s) ready` : 'Dry run only' }] });
    }

    const senderLane = await acquireDirectSenderLane(
      supabase,
      workspaceId,
      accountId,
      { attempts: 8, waitMs: 750 },
    );
    if (!senderLane.allowed) {
      return NextResponse.json({
        success: false,
        code: 'platform_capacity_busy',
        error: 'Scout is busy with other active senders. This message was not sent; retry shortly.',
        capacity_reason: senderLane.reason,
        results: [{ status: 'queued', code: 'platform_capacity_busy', reason: senderLane.reason }],
      }, { status: 429 });
    }
    senderLaneToken = senderLane.token;
    senderLaneAdmin = supabase;

    const reservation = await reserveSingleSenderSlot(supabase, {
      workspaceId,
      account,
      runId,
      batchId: batchId || `direct_${runId}`,
      runLimit,
      timezone: String(workspace.timezone || 'UTC'),
    });
    reservationId = reservation.id;
    if (!reservation.allowed) {
      return NextResponse.json({
        success: false,
        code: 'safe_capacity_reached',
        error: 'This sender has no safe sending capacity remaining for this run or today.',
        capacity_reason: reservation.reason,
        sent_today: reservation.sentToday,
        sent_rolling_24h: reservation.sentRolling24h,
        results: [{ status: 'safe_capacity_reached', code: 'safe_capacity_reached', reason: reservation.reason }],
      }, { status: 409 });
    }

    const requiredDelay = nextDelayMs(account);
    const lastSuccessfulAt = account.last_successful_send_at ? new Date(account.last_successful_send_at).getTime() : 0;
    const waitMs = lastSuccessfulAt ? Math.max(0, requiredDelay - (Date.now() - lastSuccessfulAt)) : 0;
    if (waitMs > 0) await sleep(waitMs);

    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('Access token expired and no refresh token is stored. Reconnect Gmail.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
    }

    try {
      let result;
      try {
        result = await sendWithGmail(accessToken, String(account.email), to, subject, body, account, attachments);
      } catch (initialError) {
        const first = initialError as Error & { status?: number };
        if (first.status !== 401 || !account.refresh_token) throw initialError;
        const refreshed = await refreshAccessToken(String(account.refresh_token));
        accessToken = refreshed.access_token;
        await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
        result = await sendWithGmail(accessToken, String(account.email), to, subject, body, account, attachments);
      }

      const sentAt = new Date().toISOString();
      let persisted = false;
      const { error: sentError } = await supabase.from('sent_messages').insert({
        workspace_id: workspaceId,
        business_id: businessId || null,
        template_id: templateId,
        gmail_account_id: accountId,
        batch_id: batchId,
        to_email: to,
        from_email: String(account.email),
        subject,
        body: appendSignatureToText(body, account),
        provider_message_id: result.id || null,
        gmail_thread_id: result.threadId || null,
        status: 'sent',
        delivery_status: 'sent',
        is_follow_up: isFollowUp,
        sent_at: sentAt,
        raw: {
          source: 'direct_send_api',
          schedule_id: runId,
          reservation_id: reservationId,
          sending_mode: account.sending_mode || 'normal',
          attachments: attachments.map((item) => ({ filename: item.filename, mime_type: item.mimeType, size_bytes: item.sizeBytes })),
          gmail: result,
        },
      });
      persisted = !sentError;

      if (businessId) {
        await supabase.from('businesses').update({ status: 'contacted', updated_at: sentAt }).eq('workspace_id', workspaceId).eq('id', businessId);
      }
      await supabase.from('gmail_accounts').update({
        last_successful_send_at: sentAt,
        sent_today: Number(account.sent_today || 0) + 1,
        last_error: sentError ? `Message sent but history save failed: ${sentError.message}` : null,
        updated_at: sentAt,
      }).eq('workspace_id', workspaceId).eq('id', accountId);
      await finalizeSingleSenderSlot(supabase, reservationId, true, sentError?.message);
      reservationId = null;

      return NextResponse.json({
        success: true,
        persisted,
        persistence_error: sentError?.message || null,
        run_id: runId,
        results: [{ status: 'sent', gmailMessageId: result.id || '', gmailThreadId: result.threadId || '', raw: result }],
      });
    } catch (sendErr) {
      const err = sendErr as Error & { status?: number; payload?: unknown; limitHit?: boolean; blocked?: boolean };
      await finalizeSingleSenderSlot(supabase, reservationId, false, err.message);
      reservationId = null;
      if (err.limitHit) {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await pauseSenderForLimit(supabase, workspaceId, accountId, err.message, until);
        await supabase.from('gmail_accounts').update({
          health_status: 'sender_limited',
          provider_limit_count: Number(account.provider_limit_count || 0) + 1,
          last_provider_limit_at: new Date().toISOString(),
        }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, code: 'provider_limit_hit', error: err.message, senderPausedUntil: until, results: [{ status: 'limit_hit', code: 'provider_limit_hit', reason: err.message }] }, { status: 429 });
      }
      if (err.blocked) {
        await supabase.from('gmail_accounts').update({ health_status: 'at_risk', last_error: err.message }).eq('workspace_id', workspaceId).eq('id', accountId);
        return NextResponse.json({ success: false, error: err.message, code: 'message_blocked', results: [{ status: 'message_blocked', code: 'message_blocked', reason: err.message }] }, { status: err.status || 403 });
      }
      throw err;
    }
  } catch (err) {
    if (reservationAdmin && reservationId) await finalizeSingleSenderSlot(reservationAdmin, reservationId, false, formatError(err));
    return NextResponse.json({ success: false, error: formatError(err), results: [{ status: 'failed', reason: formatError(err) }] }, { status: 400 });
  } finally {
    if (senderLaneAdmin && senderLaneToken) {
      await releaseDirectSenderLane(senderLaneAdmin, senderLaneToken).catch(() => undefined);
    }
  }
}
