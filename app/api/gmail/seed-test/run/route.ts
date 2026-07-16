export const runtime = 'nodejs';
export const maxDuration = 120;

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';
import { buildMimeMessage } from '@/lib/email-signature';
import { finalizeSingleSenderSlot, reserveSingleSenderSlot } from '@/lib/sender-capacity-server';
import { featureFlags } from '@/lib/feature-flags';

function b64url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
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

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Google OAuth environment variables are missing.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error_description || json?.error || `Token refresh failed with HTTP ${response.status}`);
  return { access_token: String(json.access_token || ''), expires_in: Number(json.expires_in || 3600) };
}

async function ensureAccessToken(supabase: ReturnType<typeof createAdminClient>, account: any) {
  let accessToken = String(account.access_token || '');
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!accessToken || expiresAt < Date.now() + 60_000) {
    if (!account.refresh_token) throw new Error(`${account.email} has no refresh token. Reconnect Gmail.`);
    const refreshed = await refreshAccessToken(String(account.refresh_token));
    accessToken = refreshed.access_token;
    await supabase.from('gmail_accounts').update({
      access_token: accessToken,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', account.id).eq('workspace_id', account.workspace_id);
  }
  return accessToken;
}

async function sendWithGmail(accessToken: string, from: string, to: string, subject: string, body: string, identity: any) {
  const message = buildMimeMessage({ from, to, subject, body, identity });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(message.raw) })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json?.error || `Gmail send failed with HTTP ${response.status}`);
  return json as { id?: string; threadId?: string };
}

const PLACEMENTS = new Set(['inbox', 'promotions', 'spam', 'not_received']);

export async function POST(request: NextRequest) {
  let reservationId: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let gmailAccepted = false;
  try {
    if (!featureFlags.placementTests) return NextResponse.json({ success: false, error: 'Placement testing is disabled.' }, { status: 503 });
    const input = await request.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || '').trim();
    const action = String(input.action || 'send').trim();
    if (!workspaceId) throw new Error('workspace_id is required.');

    const authorization = await authorizeWorkspace(workspaceId);
    if ('error' in authorization) return authorization.error;
    admin = createAdminClient();

    if (action === 'record') {
      const testId = String(input.test_id || '').trim();
      const placement = String(input.placement || '').trim().toLowerCase();
      if (!testId || !PLACEMENTS.has(placement)) throw new Error('Choose Inbox, Promotions, Spam, or Not received.');
      const checkedAt = new Date().toISOString();
      const { data: test, error: testError } = await admin.from('seed_inbox_tests').select('id,sender_gmail_account_id').eq('workspace_id', workspaceId).eq('id', testId).single();
      if (testError || !test) throw new Error(testError?.message || 'Placement test was not found.');
      const { error: updateError } = await admin.from('seed_inbox_tests').update({ placement, checked_at: checkedAt }).eq('workspace_id', workspaceId).eq('id', testId);
      if (updateError) throw updateError;
      const risk = placement === 'spam' ? 'spam_risk' : placement === 'promotions' ? 'promotion_risk' : placement === 'inbox' ? 'seed_inbox_ok' : 'not_received';
      const healthStatus = placement === 'inbox' ? 'healthy' : placement === 'promotions' ? 'needs_review' : 'at_risk';
      await admin.from('gmail_accounts').update({
        spam_risk_status: risk,
        last_seed_result: placement,
        last_seed_checked_at: checkedAt,
        health_status: healthStatus,
        ...(placement === 'inbox' ? { last_error: null } : {}),
      }).eq('workspace_id', workspaceId).eq('id', test.sender_gmail_account_id);
      return NextResponse.json({ success: true, placement, checked_at: checkedAt });
    }

    const senderId = String(input.sender_account_id || '').trim();
    const receiverId = String(input.seed_account_id || '').trim();
    if (!senderId || !receiverId) throw new Error('Choose one sender and one test receiver.');
    if (senderId === receiverId) throw new Error('Choose a different inbox as the test receiver.');

    const [{ data: sender, error: senderError }, { data: receiver, error: receiverError }, { data: workspace, error: workspaceError }] = await Promise.all([
      admin.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', senderId).single(),
      admin.from('gmail_accounts').select('id,email').eq('workspace_id', workspaceId).eq('id', receiverId).single(),
      admin.from('workspaces').select('id,timezone').eq('id', workspaceId).single(),
    ]);
    if (senderError || !sender) throw new Error(senderError?.message || 'Test sender was not found.');
    if (receiverError || !receiver) throw new Error(receiverError?.message || 'Test receiver was not found.');
    if (workspaceError || !workspace) throw new Error(workspaceError?.message || 'Scout workspace was not found.');
    if (!['connected', 'ready'].includes(String(sender.status || ''))) throw new Error('The selected sender is not connected.');

    const runId = randomUUID();
    const reservation = await reserveSingleSenderSlot(admin, {
      workspaceId,
      account: sender,
      runId,
      batchId: `placement_test_${runId}`,
      runLimit: 1,
      timezone: String(workspace.timezone || 'UTC'),
    });
    reservationId = reservation.id;
    if (!reservation.allowed) {
      return NextResponse.json({ success: false, code: 'safe_capacity_reached', error: 'This sender has no safe sending capacity remaining today.', capacity_reason: reservation.reason }, { status: 409 });
    }

    const accessToken = await ensureAccessToken(admin, sender);
    const stamp = Date.now();
    const subject = `[Scout placement test ${stamp}] ${sender.email}`;
    const body = `This is a controlled Scout placement test sent to an inbox you own.\n\nSender: ${sender.email}\nTest receiver: ${receiver.email}\nReference: ${stamp}`;
    const sentMessage = await sendWithGmail(accessToken, String(sender.email), String(receiver.email), subject, body, sender);
    gmailAccepted = true;
    const sentAt = new Date().toISOString();

    const { data: test, error: testError } = await admin.from('seed_inbox_tests').insert({
      workspace_id: workspaceId,
      sender_gmail_account_id: sender.id,
      seed_gmail_account_id: receiver.id,
      sender_email: String(sender.email).toLowerCase(),
      seed_email: String(receiver.email).toLowerCase(),
      subject,
      placement: 'awaiting_manual_check',
      gmail_message_id: sentMessage.id || null,
      gmail_thread_id: sentMessage.threadId || null,
      raw: { source: 'v10_35_send_only_manual_placement', permission_mode: 'gmail.send_only', reference: stamp },
    }).select('id,sender_email,seed_email,subject,placement,created_at').single();
    if (testError) throw testError;

    const { error: sentHistoryError } = await admin.from('sent_messages').insert({
      workspace_id: workspaceId,
      gmail_account_id: sender.id,
      to_email: String(receiver.email).toLowerCase(),
      from_email: String(sender.email).toLowerCase(),
      subject,
      body,
      provider_message_id: sentMessage.id || null,
      gmail_thread_id: sentMessage.threadId || null,
      status: 'sent',
      delivery_status: 'placement_test_sent',
      sent_at: sentAt,
      raw: { source: 'placement_test', schedule_id: runId, reservation_id: reservationId, seed_test_id: test.id },
    });
    await admin.from('gmail_accounts').update({
      last_successful_send_at: sentAt,
      sent_today: Number(sender.sent_today || 0) + 1,
      last_error: sentHistoryError ? `Placement test sent but history save failed: ${sentHistoryError.message}` : null,
      updated_at: sentAt,
    }).eq('workspace_id', workspaceId).eq('id', sender.id);
    await finalizeSingleSenderSlot(admin, reservationId, true, sentHistoryError?.message);
    reservationId = null;

    return NextResponse.json({
      success: true,
      sent: 1,
      test,
      message: `Test sent to ${receiver.email}. Open that inbox and record where it arrived.`,
    });
  } catch (error) {
    if (admin && reservationId) await finalizeSingleSenderSlot(admin, reservationId, gmailAccepted, formatError(error));
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ success: false, error: 'Placement tests must be started by a signed-in user from Settings.' }, { status: 405 });
}
