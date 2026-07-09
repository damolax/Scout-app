import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRecord = Record<string, any>;

type NormalizedInbound = {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  fromRaw: string;
  toEmail: string;
  toRaw: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: string;
  labelIds: string[];
  candidateEmails: string[];
  raw: AnyRecord;
};

type Classification = {
  classification: string;
  isRealReply: boolean;
  noInbox: boolean;
  blocked: boolean;
  temporary: boolean;
  ignored: boolean;
  businessStatus?: 'responded' | 'no_inbox' | 'bounced';
};

type SyncMode = 'replies' | 'bounces';

type SyncParams = {
  supabase: SupabaseClient<any, any, any>;
  workspaceId: string;
  accountId: string;
  maxResults?: number;
  mode: SyncMode;
  days?: number;
};

type InboundStats = {
  success: true;
  scanned: number;
  saved: number;
  matched: number;
  realReplies: number;
  noInbox: number;
  blocked: number;
  temporary: number;
  ignored: number;
  unmatched: number;
  accountEmail: string;
};

const SENT_COLUMNS = 'id,business_id,to_email,from_email,subject,template_id,gmail_account_id,batch_id,provider_message_id,gmail_thread_id,sent_at';

export function formatInboundError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function normalizeEmail(value: unknown) {
  const raw = String(value || '').toLowerCase().replace(/<([^>]+)>/g, ' $1 ');
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] || '';
}

function extractEmails(value: unknown) {
  const text = String(value || '').toLowerCase().replace(/<([^>]+)>/g, ' $1 ');
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const bad = ['mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'donotreply', 'do-not-reply'];
  return Array.from(new Set(matches.map((m) => m.toLowerCase()).filter((email) => !bad.some((term) => email.includes(term)))));
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return (headers || []).find((h) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBody(data?: string) {
  if (!data) return '';
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function stripHtml(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectBodyParts(part: AnyRecord | undefined, out: { plain: string[]; html: string[] }) {
  if (!part) return;
  const mime = String(part.mimeType || '').toLowerCase();
  const data = part.body?.data ? decodeBody(String(part.body.data)) : '';
  if (data && mime.includes('text/plain')) out.plain.push(data);
  if (data && mime.includes('text/html')) out.html.push(stripHtml(data));
  const parts = Array.isArray(part.parts) ? part.parts : [];
  for (const child of parts) collectBodyParts(child, out);
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

async function gmailJson(accessToken: string, url: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || json?.error || `Gmail request failed with HTTP ${response.status}`);
  return json;
}

async function ensureAccessToken(supabase: SupabaseClient<any, any, any>, workspaceId: string, account: AnyRecord) {
  let accessToken = String(account.access_token || '');
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!accessToken || expiresAt < Date.now() + 60_000) {
    if (!account.refresh_token) throw new Error('Access token expired and no refresh token is stored. Reconnect Gmail in Settings.');
    const refreshed = await refreshAccessToken(String(account.refresh_token));
    accessToken = refreshed.access_token;
    await supabase.from('gmail_accounts').update({
      access_token: accessToken,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId).eq('id', account.id);
  }
  return accessToken;
}

function normalizeGmailMessage(msg: AnyRecord): NormalizedInbound {
  const headers = msg.payload?.headers || [];
  const fromRaw = header(headers, 'From');
  const toRaw = header(headers, 'To');
  const subject = header(headers, 'Subject');
  const parts = { plain: [] as string[], html: [] as string[] };
  collectBodyParts(msg.payload, parts);
  const body = (parts.plain.join('\n') || parts.html.join('\n') || String(msg.snippet || '')).trim();
  const snippet = String(msg.snippet || '').trim();
  const textForEmails = `${fromRaw}\n${toRaw}\n${subject}\n${snippet}\n${body}`;
  return {
    gmailMessageId: String(msg.id || ''),
    gmailThreadId: String(msg.threadId || ''),
    fromEmail: normalizeEmail(fromRaw),
    fromRaw,
    toEmail: normalizeEmail(toRaw),
    toRaw,
    subject,
    snippet,
    body,
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    labelIds: Array.isArray(msg.labelIds) ? msg.labelIds : [],
    candidateEmails: extractEmails(textForEmails),
    raw: { source: 'native_gmail_inbound_sync', gmail: msg, fromRaw, toRaw, subject, snippet }
  };
}

function classifyInbound(message: NormalizedInbound, sentMatch: AnyRecord | null, accountEmail: string): Classification {
  const text = `${message.fromRaw} ${message.fromEmail} ${message.subject} ${message.snippet} ${message.body}`.toLowerCase();
  const isSelf = message.fromEmail && message.fromEmail === accountEmail.toLowerCase();
  const noInboxTerms = [
    'address not found', 'user unknown', 'no such user', 'mailbox unavailable', 'mailbox not found',
    'recipient address rejected', 'does not exist', 'doesn\'t exist', '550 5.1.1', '5.1.1',
    'recipient not found', 'unknown recipient', 'invalid recipient', 'delivery to the following recipient failed permanently'
  ];
  const blockedTerms = [
    'message blocked', 'blocked', 'rejected due to security', 'rejected by our system', 'policy reason',
    'spam content', 'looks like spam', 'similar to messages that were identified as spam', 'unsolicited mail'
  ];
  const bounceTerms = [
    'mailer-daemon', 'mail delivery subsystem', 'postmaster', 'delivery status notification', 'undeliverable',
    'message not delivered', 'delivery incomplete', 'delivery failed', 'permanent failure', 'failure notice'
  ];
  const limitTerms = ['sending limit', 'rate limit', 'quota exceeded', 'daily user sending quota exceeded', 'too many messages', 'user-rate limit'];
  const autoTerms = ['out of office', 'automatic reply', 'auto-reply', 'vacation responder', 'autoreply', 'auto reply'];
  const temporaryTerms = ['temporary failure', 'try again later', 'deferred', '4.2.0', '4.4.1', '4.7.0', 'temporarily unavailable'];

  if (limitTerms.some((term) => text.includes(term))) return { classification: 'gmail_limit_notice', isRealReply: false, noInbox: false, blocked: false, temporary: false, ignored: true };
  if (noInboxTerms.some((term) => text.includes(term))) return { classification: 'no_inbox', isRealReply: false, noInbox: true, blocked: false, temporary: false, ignored: false, businessStatus: 'no_inbox' };
  if (blockedTerms.some((term) => text.includes(term)) && bounceTerms.some((term) => text.includes(term))) return { classification: 'message_blocked', isRealReply: false, noInbox: false, blocked: true, temporary: false, ignored: false, businessStatus: 'bounced' };
  if (bounceTerms.some((term) => text.includes(term))) return { classification: 'bounce_notice', isRealReply: false, noInbox: false, blocked: false, temporary: false, ignored: true, businessStatus: 'bounced' };
  if (blockedTerms.some((term) => text.includes(term))) return { classification: 'message_blocked', isRealReply: false, noInbox: false, blocked: true, temporary: false, ignored: false, businessStatus: 'bounced' };
  if (temporaryTerms.some((term) => text.includes(term))) return { classification: 'temporary_failure', isRealReply: false, noInbox: false, blocked: false, temporary: true, ignored: true };
  if (autoTerms.some((term) => text.includes(term))) return { classification: 'auto_reply_ignored', isRealReply: false, noInbox: false, blocked: false, temporary: false, ignored: true };
  if (isSelf) return { classification: 'self_message_ignored', isRealReply: false, noInbox: false, blocked: false, temporary: false, ignored: true };
  if (!sentMatch) return { classification: 'unmatched_inbound', isRealReply: false, noInbox: false, blocked: false, temporary: false, ignored: true };
  return { classification: 'real_reply', isRealReply: true, noInbox: false, blocked: false, temporary: false, ignored: false, businessStatus: 'responded' };
}

async function findSentMatch(supabase: SupabaseClient<any, any, any>, workspaceId: string, message: NormalizedInbound) {
  if (message.gmailThreadId) {
    const { data, error } = await supabase
      .from('sent_messages')
      .select(SENT_COLUMNS)
      .eq('workspace_id', workspaceId)
      .eq('gmail_thread_id', message.gmailThreadId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as AnyRecord;
  }

  const candidates = Array.from(new Set([message.fromEmail, ...message.candidateEmails].filter(Boolean))).slice(0, 12);
  for (const email of candidates) {
    const { data, error } = await supabase
      .from('sent_messages')
      .select(SENT_COLUMNS)
      .eq('workspace_id', workspaceId)
      .ilike('to_email', email)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as AnyRecord;
  }
  return null;
}

async function saveReplyHistory(supabase: SupabaseClient<any, any, any>, payload: AnyRecord) {
  const { data, error } = await supabase
    .from('reply_history')
    .select('id')
    .eq('workspace_id', payload.workspace_id)
    .eq('gmail_message_id', payload.gmail_message_id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) {
    const { error: updateError } = await supabase.from('reply_history').update(payload).eq('id', data.id);
    if (updateError) throw updateError;
    return 'updated';
  }
  const { error: insertError } = await supabase.from('reply_history').insert(payload);
  if (insertError) throw insertError;
  return 'inserted';
}

async function saveNoInboxRecord(supabase: SupabaseClient<any, any, any>, payload: AnyRecord) {
  const { data, error } = await supabase
    .from('no_inbox_records')
    .select('id')
    .eq('workspace_id', payload.workspace_id)
    .eq('gmail_message_id', payload.gmail_message_id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) {
    const { error: updateError } = await supabase.from('no_inbox_records').update(payload).eq('id', data.id);
    if (updateError) throw updateError;
    return 'updated';
  }
  const { error: insertError } = await supabase.from('no_inbox_records').insert(payload);
  if (insertError) throw insertError;
  return 'inserted';
}


function isUsableFailureTarget(email: string | null | undefined, accountEmail: string, message: NormalizedInbound, sentMatch: AnyRecord | null) {
  const value = normalizeEmail(email || '');
  if (!value) return false;
  const selfEmails = new Set([
    normalizeEmail(accountEmail),
    normalizeEmail(message.toEmail),
    normalizeEmail(sentMatch?.from_email),
    normalizeEmail(sentMatch?.sender_email),
    normalizeEmail(sentMatch?.reply_to_email)
  ].filter(Boolean));
  if (selfEmails.has(value)) return false;
  if (value.includes('mailer-daemon') || value.includes('postmaster')) return false;
  if (value.endsWith('@googlemail.com') || value.endsWith('@gmail.com') && value === normalizeEmail(accountEmail)) return false;
  return true;
}

function findFailureTargetEmail(message: NormalizedInbound, sentMatch: AnyRecord | null, accountEmail: string) {
  const sentTo = normalizeEmail(sentMatch?.to_email || '');
  if (isUsableFailureTarget(sentTo, accountEmail, message, sentMatch)) return sentTo;
  for (const email of message.candidateEmails) {
    if (isUsableFailureTarget(email, accountEmail, message, sentMatch)) return email;
  }
  return null;
}

async function applyClassificationUpdates(supabase: SupabaseClient<any, any, any>, workspaceId: string, message: NormalizedInbound, sentMatch: AnyRecord | null, classification: Classification, accountId: string, accountEmail: string) {
  const targetEmail = classification.noInbox || classification.blocked || classification.classification === 'bounce_notice'
    ? findFailureTargetEmail(message, sentMatch, accountEmail)
    : (sentMatch?.to_email || message.fromEmail || null);
  await saveReplyHistory(supabase, {
    workspace_id: workspaceId,
    business_id: sentMatch?.business_id || null,
    sent_message_id: sentMatch?.id || null,
    template_id: sentMatch?.template_id || null,
    gmail_account_id: sentMatch?.gmail_account_id || accountId,
    batch_id: sentMatch?.batch_id || null,
    from_email: message.fromEmail || message.fromRaw,
    to_email: message.toEmail || targetEmail,
    subject: message.subject,
    snippet: message.snippet || message.body.slice(0, 240),
    body: message.body,
    classification: classification.classification,
    is_real_reply: classification.isRealReply,
    received_at: message.receivedAt,
    gmail_message_id: message.gmailMessageId,
    gmail_thread_id: message.gmailThreadId || sentMatch?.gmail_thread_id || null,
    matched_status: sentMatch ? 'matched' : 'unmatched',
    raw: { ...message.raw, classification, sent_match_id: sentMatch?.id || null, candidateEmails: message.candidateEmails }
  });

  if (sentMatch?.id) {
    const deliveryStatus = classification.isRealReply ? 'replied' : classification.classification;
    await supabase.from('sent_messages').update({
      delivery_status: deliveryStatus,
      error_code: classification.isRealReply ? null : classification.classification,
      last_reply_at: message.receivedAt
    }).eq('workspace_id', workspaceId).eq('id', sentMatch.id);
  }

  if (classification.businessStatus && sentMatch?.business_id) {
    await supabase.from('businesses').update({
      status: classification.businessStatus,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId).eq('id', sentMatch.business_id);
  }

  if ((classification.noInbox || classification.blocked || classification.classification === 'bounce_notice') && targetEmail) {
    await saveNoInboxRecord(supabase, {
      workspace_id: workspaceId,
      business_id: sentMatch?.business_id || null,
      sent_message_id: sentMatch?.id || null,
      gmail_account_id: sentMatch?.gmail_account_id || accountId,
      template_id: sentMatch?.template_id || null,
      email: targetEmail,
      reason: classification.classification,
      gmail_message_id: message.gmailMessageId,
      gmail_thread_id: message.gmailThreadId || sentMatch?.gmail_thread_id || null,
      raw: { ...message.raw, classification, sent_match_id: sentMatch?.id || null, candidateEmails: message.candidateEmails }
    });
  }
}

function buildQuery(mode: SyncMode, days: number) {
  if (mode === 'bounces') {
    return `newer_than:${days}d (from:mailer-daemon OR from:postmaster OR from:"Mail Delivery Subsystem" OR subject:Undelivered OR subject:"Delivery Status Notification" OR subject:"Message blocked" OR "address not found" OR "message blocked" OR "user unknown" OR "recipient address rejected")`;
  }
  return `newer_than:${days}d -from:me -in:sent`;
}

export async function syncGmailInbound({ supabase, workspaceId, accountId, maxResults = 100, mode, days = 30 }: SyncParams): Promise<InboundStats> {
  if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');
  const limit = Math.max(1, Math.min(Number(maxResults || 100), 500));
  const { data: account, error: accountError } = await supabase.from('gmail_accounts').select('*').eq('workspace_id', workspaceId).eq('id', accountId).single();
  if (accountError || !account) throw new Error(accountError?.message || 'Gmail account not found.');

  const accessToken = await ensureAccessToken(supabase, workspaceId, account as AnyRecord);
  const query = encodeURIComponent(buildQuery(mode, Math.max(1, Math.min(Number(days || 30), 90))));
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${limit}&includeSpamTrash=true`;
  const list = await gmailJson(accessToken, listUrl);
  const messages: Array<{ id: string; threadId?: string }> = Array.isArray(list.messages) ? list.messages : [];

  const stats: InboundStats = { success: true, scanned: 0, saved: 0, matched: 0, realReplies: 0, noInbox: 0, blocked: 0, temporary: 0, ignored: 0, unmatched: 0, accountEmail: String((account as AnyRecord).email || '') };

  for (const item of messages) {
    stats.scanned += 1;
    const gmailMessage = await gmailJson(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`);
    const normalized = normalizeGmailMessage(gmailMessage);
    const sentMatch = await findSentMatch(supabase, workspaceId, normalized);
    if (sentMatch) stats.matched += 1;
    const classification = classifyInbound(normalized, sentMatch, String((account as AnyRecord).email || ''));

    if (mode === 'bounces' && !classification.noInbox && !classification.blocked && classification.classification !== 'bounce_notice' && !classification.temporary) {
      stats.ignored += 1;
      continue;
    }

    await applyClassificationUpdates(supabase, workspaceId, normalized, sentMatch, classification, accountId, String((account as AnyRecord).email || ''));
    stats.saved += 1;
    if (classification.isRealReply) stats.realReplies += 1;
    else if (classification.noInbox) stats.noInbox += 1;
    else if (classification.blocked) stats.blocked += 1;
    else if (classification.temporary) stats.temporary += 1;
    else if (classification.classification === 'unmatched_inbound') stats.unmatched += 1;
    else stats.ignored += 1;
  }

  await supabase.from('gmail_accounts').update({ last_error: null, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', accountId);
  return stats;
}
