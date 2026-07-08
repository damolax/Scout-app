export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
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

async function gmailFetch(accessToken: string, url: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json?.error || `Gmail fetch failed with HTTP ${response.status}`);
  return json;
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string) {
  return (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function emailFrom(text: string) {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() || '';
}

function classifyDeliveryNotice(text: string) {
  const t = text.toLowerCase();
  const messageBlocked = t.includes('message blocked') || t.includes('blocked') || t.includes('policy') || t.includes('spam') || t.includes('rejected due to security') || t.includes('rejected by our system');
  const noInbox = t.includes('address not found') || t.includes('user unknown') || t.includes('mailbox unavailable') || t.includes('mailbox not found') || t.includes('recipient address rejected') || t.includes('does not exist') || t.includes('550 5.1.1') || t.includes('5.1.1') || t.includes('no such user');
  const temporary = t.includes('temporary failure') || t.includes('try again later') || t.includes('deferred') || t.includes('4.');
  if (noInbox) return { classification: 'no_inbox', noInbox: true, blocked: false, temporary: false };
  if (messageBlocked) return { classification: 'message_blocked', noInbox: false, blocked: true, temporary: false };
  if (temporary) return { classification: 'temporary_failure', noInbox: false, blocked: false, temporary: true };
  return { classification: 'delivery_notice', noInbox: false, blocked: false, temporary: false };
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    const workspaceId = String(input.workspace_id || '');
    const accountId = String(input.gmail_account_id || '');
    const maxResults = Math.max(1, Math.min(Number(input.max_results || 50), 200));
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');

    const supabase = createAdminClient();
    const { data: account, error: accountError } = await supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single();
    if (accountError || !account) throw new Error(accountError?.message || 'Gmail sender account not found.');

    let accessToken = String(account.access_token || '');
    const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!account.refresh_token) throw new Error('Access token expired and no refresh token is stored. Reconnect Gmail.');
      const refreshed = await refreshAccessToken(String(account.refresh_token));
      accessToken = refreshed.access_token;
      await supabase.from('gmail_accounts').update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), last_error: null }).eq('workspace_id', workspaceId).eq('id', accountId);
    }

    const q = encodeURIComponent('newer_than:21d (from:mailer-daemon OR from:"Mail Delivery Subsystem" OR subject:"Delivery Status Notification" OR subject:Undelivered OR subject:"Message blocked" OR "address not found" OR "message blocked")');
    const list = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${maxResults}`);
    const messages: Array<{ id: string; threadId?: string }> = list.messages || [];
    let scanned = 0;
    let noInbox = 0;
    let blocked = 0;
    let temporary = 0;
    let matched = 0;

    for (const item of messages) {
      scanned += 1;
      const msg = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`);
      const headers = msg.payload?.headers || [];
      const subject = header(headers, 'Subject');
      const from = header(headers, 'From');
      const to = header(headers, 'To');
      const snippet = String(msg.snippet || '');
      const text = `${subject}\n${from}\n${to}\n${snippet}`;
      const classification = classifyDeliveryNotice(text);
      if (classification.noInbox) noInbox += 1;
      if (classification.blocked) blocked += 1;
      if (classification.temporary) temporary += 1;

      const bouncedEmail = emailFrom(snippet) || emailFrom(subject) || emailFrom(to);
      let sentMatch: any = null;
      if (msg.threadId) {
        const { data } = await supabase.from('sent_messages').select('*').eq('workspace_id', workspaceId).eq('gmail_thread_id', msg.threadId).order('sent_at', { ascending: false }).limit(1).maybeSingle();
        sentMatch = data || null;
      }
      if (!sentMatch && bouncedEmail) {
        const { data } = await supabase.from('sent_messages').select('*').eq('workspace_id', workspaceId).eq('to_email', bouncedEmail).order('sent_at', { ascending: false }).limit(1).maybeSingle();
        sentMatch = data || null;
      }
      if (sentMatch) matched += 1;

      await supabase.from('reply_history').upsert({
        workspace_id: workspaceId,
        business_id: sentMatch?.business_id || null,
        sent_message_id: sentMatch?.id || null,
        template_id: sentMatch?.template_id || null,
        gmail_account_id: sentMatch?.gmail_account_id || accountId,
        batch_id: sentMatch?.batch_id || null,
        from_email: emailFrom(from) || from,
        to_email: bouncedEmail || sentMatch?.to_email || null,
        subject,
        snippet,
        body: snippet,
        classification: classification.classification,
        is_real_reply: false,
        received_at: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
        gmail_message_id: msg.id,
        gmail_thread_id: msg.threadId || null,
        matched_status: sentMatch ? 'matched' : 'unmatched',
        raw: { source: 'gmail_sync_bounces', from, to, subject, snippet, classification }
      }, { onConflict: 'workspace_id,gmail_message_id' });

      if (sentMatch?.id) {
        await supabase.from('sent_messages').update({ delivery_status: classification.classification, error_code: classification.classification, last_reply_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', sentMatch.id);
      }

      if (classification.noInbox || classification.blocked) {
        await supabase.from('no_inbox_records').insert({
          workspace_id: workspaceId,
          business_id: classification.noInbox ? (sentMatch?.business_id || null) : null,
          sent_message_id: sentMatch?.id || null,
          gmail_account_id: sentMatch?.gmail_account_id || accountId,
          template_id: sentMatch?.template_id || null,
          email: bouncedEmail || sentMatch?.to_email || null,
          reason: classification.classification,
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId || null,
          raw: { source: 'gmail_sync_bounces', from, to, subject, snippet }
        });
        if (classification.noInbox && sentMatch?.business_id) await supabase.from('businesses').update({ status: 'no_inbox', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', sentMatch.business_id);
      }
    }

    return NextResponse.json({ success: true, scanned, matched, noInbox, blocked, temporary });
  } catch (err) {
    return NextResponse.json({ success: false, error: formatError(err) }, { status: 400 });
  }
}
