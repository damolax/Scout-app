'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Business, Workspace } from '@/lib/types';

type TemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  subject: string;
  subject_variants?: string[] | null;
  message: string;
  active?: boolean | null;
  created_at: string;
};

type GmailAccount = {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string | null;
  status: string;
  access_token?: string | null;
  refresh_token?: string | null;
  client_id?: string | null;
  expires_at?: string | null;
  daily_limit?: number | null;
  sent_today?: number | null;
  paused_until?: string | null;
  last_error?: string | null;
  raw?: Record<string, unknown> | null;
  created_at: string;
};

type SendLogRow = {
  id: string;
  status?: string | null;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  sent_at?: string | null;
  raw?: Record<string, unknown> | null;
};

type ReplyRow = {
  id: string;
  is_real_reply?: boolean | null;
  classification?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  raw?: Record<string, unknown> | null;
};

type SendResult = {
  id?: string;
  email?: string;
  status?: string;
  subject?: string;
  reason?: string;
  code?: string;
  stopBatch?: boolean;
  gmailMessageId?: string;
  gmailThreadId?: string;
  pausedUntil?: string;
  [key: string]: unknown;
};

type SendSummary = {
  requested: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  stopped: boolean;
};

const READY_PAGE_SIZE = 100;
const MAX_MESSAGE_BATCH_SIZE = 5000;
const DEFAULT_TEMPLATE_MESSAGE = `Hi {name},\n\nI came across {business} and noticed there may be a few simple ways to improve how prospects move from first visit to enquiry.\n\nI can send you a short review with the first changes I would make for {business}.\n\nBest regards,\nOlalekan`;
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
].join(' ');

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const item = error as { message?: string; code?: string; details?: string; hint?: string; error?: string; reason?: string };
    return [item.message || item.error, item.reason, item.code ? `Code: ${item.code}` : '', item.details, item.hint].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

function splitSubjects(subject: string, variants?: string[] | null) {
  const all = [subject, ...(variants || [])]
    .flatMap((item) => String(item || '').split('\n'))
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

function getDomain(business: Business) {
  if (business.domain) return business.domain;
  try {
    if (business.website) return new URL(business.website.startsWith('http') ? business.website : `https://${business.website}`).hostname.replace(/^www\./, '');
  } catch {}
  const emailDomain = String(business.email || '').split('@')[1] || '';
  return emailDomain;
}

function renderTemplate(text: string, business: Business) {
  const domain = getDomain(business);
  const values: Record<string, string> = {
    name: business.name || 'there',
    business: business.name || 'your business',
    company: business.name || 'your company',
    email: business.email || '',
    website: business.website || domain || '',
    domain,
    phone: business.phone || '',
    category: business.category || 'business',
    industry: business.category || 'business',
    location: business.location || 'your area',
    source: business.source || 'Scout'
  };
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => values[String(key).toLowerCase()] ?? '');
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isPaused(account: GmailAccount) {
  if (!account.paused_until) return false;
  return new Date(account.paused_until).getTime() > Date.now();
}

function isLimitPayload(json: any, result?: SendResult) {
  const code = String(json?.code || json?.reason || json?.stopReason || result?.code || result?.reason || '').toLowerCase();
  const message = String(json?.error || json?.message || result?.reason || '').toLowerCase();
  return json?.forceStopped || result?.stopBatch || code.includes('limit') || message.includes('limit reached') || message.includes('sending limit');
}

function toDateTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 5, 0, 0);
  return d.toISOString();
}

function getMessageRoutePath() {
  if (typeof window === 'undefined') return '/message';
  return window.location.pathname.startsWith('/message') ? '/message' : '/message';
}

function getMessageRedirectUri() {
  if (typeof window === 'undefined') return '/message';
  return `${window.location.origin}${getMessageRoutePath()}`;
}

export default function EmailScoutClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [readyContacts, setReadyContacts] = useState<Business[]>([]);
  const [readyTotal, setReadyTotal] = useState(0);
  const [selectedContacts, setSelectedContacts] = useState<Record<string, boolean>>({});
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, boolean>>({});
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('Cold outreach review');
  const [subject, setSubject] = useState('{name}, quick question');
  const [subjectVariants, setSubjectVariants] = useState('{business}, quick idea\nQuick idea for {name}');
  const [message, setMessage] = useState(DEFAULT_TEMPLATE_MESSAGE);
  const [googleClientId, setGoogleClientId] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');
  const [manualClientId, setManualClientId] = useState('');
  const [showAdvancedTokens, setShowAdvancedTokens] = useState(false);
  const [sendLimit, setSendLimit] = useState(50);
  const [delayMs, setDelayMs] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [readySearch, setReadySearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Select a template, select Gmail accounts, then send a fixed-size batch from Ready-to-message contacts.');
  const [error, setError] = useState('');
  const [backendNote, setBackendNote] = useState('');
  const [lastResults, setLastResults] = useState<Array<Record<string, unknown>>>([]);
  const [recentSent, setRecentSent] = useState<SendLogRow[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [summary, setSummary] = useState<SendSummary>({ requested: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, stopped: false });

  const selectedContactIds = Object.keys(selectedContacts).filter((id) => selectedContacts[id]);
  const selectedAccountIds = Object.keys(selectedAccounts).filter((id) => selectedAccounts[id]);
  const currentTemplate = templates.find((t) => t.id === templateId) || templates[0];
  const previewBusiness = readyContacts.find((b) => selectedContacts[b.id]) || readyContacts[0];

  async function checkBackend() {
    try {
      const response = await fetch('/api/backend/gmail/status');
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || json?.message || `Backend returned HTTP ${response.status}`);
      setBackendNote(`Backend OK · Gmail send endpoint: ${json?.endpoints?.send_selected_batch ? 'available' : 'not confirmed'} · Google secret: ${json?.google_client_secret_set ? 'set' : 'missing'}`);
    } catch (err) {
      setBackendNote(`Backend check failed: ${formatError(err)}`);
    }
  }

  async function loadTemplates() {
    const { data, error: loadError } = await supabase
      .from('templates')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;
    const rows = (data || []) as TemplateRow[];
    setTemplates(rows);
    if (!templateId && rows[0]?.id) setTemplateId(rows[0].id);
  }

  async function loadAccounts() {
    const { data, error: loadError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;
    const rows = (data || []) as GmailAccount[];
    setAccounts(rows);
    setSelectedAccounts((current) => {
      const next: Record<string, boolean> = {};
      for (const account of rows) next[account.id] = current[account.id] ?? (account.status === 'connected' && !isPaused(account));
      return next;
    });
  }

  async function loadReadyContacts() {
    const cleanSearch = readySearch.trim().replace(/[%_]/g, '');
    const targetBusinessId = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('business') : '';
    let query = supabase
      .from('businesses')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspace.id)
      .eq('status', 'ready')
      .not('email', 'is', null)
      .neq('email', '')
      .order('updated_at', { ascending: true })
      .limit(READY_PAGE_SIZE);
    if (cleanSearch) query = query.or(`name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`);
    const { data, error: loadError, count } = await query;
    if (loadError) throw loadError;

    let rows = (data || []) as Business[];
    let selected: Record<string, boolean> = {};

    if (targetBusinessId) {
      const { data: target, error: targetError } = await supabase
        .from('businesses')
        .select('*')
        .eq('workspace_id', workspace.id)
        .eq('id', targetBusinessId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (target?.email) {
        rows = [target as Business, ...rows.filter((b) => b.id !== target.id)].slice(0, READY_PAGE_SIZE);
        selected = { [target.id]: true };
        setStatus(`Loaded selected business for Message: ${target.name || target.email}.`);
      } else if (target) {
        setStatus('Selected business has no email yet. Send it to Auto Scout first, then return to Message.');
      }
    }

    setReadyContacts(rows);
    setReadyTotal(count || rows.length);
    setSelectedContacts(selected);
  }

  async function loadPerformance() {
    const [{ data: sentRows }, { data: replyRows }] = await Promise.all([
      supabase.from('sent_messages').select('id,status,to_email,from_email,subject,template_id,gmail_account_id,sent_at,raw').eq('workspace_id', workspace.id).order('sent_at', { ascending: false }).limit(500),
      supabase.from('reply_history').select('id,is_real_reply,classification,template_id,gmail_account_id,raw').eq('workspace_id', workspace.id).order('received_at', { ascending: false }).limit(500)
    ]);
    setRecentSent((sentRows || []) as SendLogRow[]);
    setReplies((replyRows || []) as ReplyRow[]);
  }

  async function refreshAll() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadTemplates(), loadAccounts(), loadReadyContacts(), loadPerformance(), checkBackend()]);
      setStatus('Loaded templates, Gmail accounts, Ready-to-message contacts, and recent performance.');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedClientId = localStorage.getItem('scout_v814_google_client_id') || '';
    setGoogleClientId(savedClientId);
    setManualClientId(savedClientId);
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    handleOauthReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  async function handleOauthReturn() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || state !== 'scout_v814_gmail') return;
    const clientId = googleClientId || localStorage.getItem('scout_v814_google_client_id') || '';
    if (!clientId) {
      setError('Google OAuth returned a code, but Google Client ID is missing. Save the Client ID and reconnect Gmail.');
      return;
    }
    setBusy(true);
    setStatus('Completing Gmail connection...');
    try {
      const redirectUri = getMessageRedirectUri();
      const response = await fetch('/api/backend/gmail/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, client_id: clientId, redirect_uri: redirectUri })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || json?.message || `Gmail exchange failed with HTTP ${response.status}`);
      await saveGmailAccount({
        email: json.email,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        client_id: clientId,
        expires_in: json.expires_in,
        status: 'connected',
        raw: { scope: json.scope, profile_source: json.profile_source, connected_at: new Date().toISOString() }
      });
      url.searchParams.delete('code');
      url.searchParams.delete('scope');
      url.searchParams.delete('state');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      setStatus(`Connected Gmail account: ${json.email}`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveGmailAccount(input: { email: string; access_token?: string; refresh_token?: string; client_id?: string; expires_in?: number; status?: string; raw?: Record<string, unknown> }) {
    const email = normalizeEmail(input.email);
    if (!email) throw new Error('Gmail email is required.');
    const expiresAt = input.expires_in ? new Date(Date.now() + Number(input.expires_in) * 1000).toISOString() : null;
    const payload = {
      workspace_id: workspace.id,
      email,
      display_name: email,
      status: input.status || 'connected',
      access_token: input.access_token || null,
      refresh_token: input.refresh_token || null,
      client_id: input.client_id || null,
      expires_at: expiresAt,
      raw: input.raw || {}
    };
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert(payload, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;
  }

  function startGmailOauth() {
    if (!googleClientId.trim()) {
      setError('Paste your Google OAuth Client ID first.');
      return;
    }
    localStorage.setItem('scout_v814_google_client_id', googleClientId.trim());
    const redirectUri = getMessageRedirectUri();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', googleClientId.trim());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', 'scout_v814_gmail');
    window.location.href = url.toString();
  }

  async function addManualAccount() {
    setBusy(true);
    setError('');
    try {
      if (!manualEmail.trim()) throw new Error('Sender email is required.');
      await saveGmailAccount({
        email: manualEmail,
        access_token: manualAccessToken || undefined,
        refresh_token: manualRefreshToken || undefined,
        client_id: manualClientId || googleClientId || undefined,
        status: manualAccessToken || manualRefreshToken ? 'connected' : 'needs_token',
        raw: { added_manually: true, added_at: new Date().toISOString() }
      });
      setManualEmail('');
      setManualAccessToken('');
      setManualRefreshToken('');
      setStatus('Gmail sender saved. Use Verify Profile before sending if you added tokens manually.');
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifySenderProfile(account: GmailAccount) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/backend/gmail/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          client_id: account.client_id || googleClientId
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || json?.message || `Profile check failed with HTTP ${response.status}`);
      const update: Record<string, unknown> = { status: 'connected', email: normalizeEmail(json.email || account.email), display_name: normalizeEmail(json.email || account.email), last_error: null };
      if (json.access_token) update.access_token = json.access_token;
      const { error: updateError } = await supabase.from('gmail_accounts').update(update).eq('workspace_id', workspace.id).eq('id', account.id);
      if (updateError) throw updateError;
      setStatus(`Verified sender profile: ${json.email}`);
      await loadAccounts();
    } catch (err) {
      const msg = formatError(err);
      setError(msg);
      await supabase.from('gmail_accounts').update({ status: 'error', last_error: msg }).eq('workspace_id', workspace.id).eq('id', account.id);
      await loadAccounts();
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const payload = {
        workspace_id: workspace.id,
        name: templateName.trim() || 'Untitled template',
        subject: subject.trim(),
        subject_variants: subjectVariants.split('\n').map((line) => line.trim()).filter(Boolean),
        message: message.trim(),
        active: true,
        created_by: user.id
      };
      if (!payload.subject || !payload.message) throw new Error('Subject and message are required.');
      const { data, error: insertError } = await supabase.from('templates').insert(payload).select('*').single();
      if (insertError) throw insertError;
      setStatus('Template saved.');
      await loadTemplates();
      if (data?.id) setTemplateId(data.id);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateTemplateFromEditor() {
    if (!currentTemplate) return;
    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('templates')
        .update({
          name: templateName.trim() || currentTemplate.name,
          subject: subject.trim(),
          subject_variants: subjectVariants.split('\n').map((line) => line.trim()).filter(Boolean),
          message: message.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspace.id)
        .eq('id', currentTemplate.id);
      if (updateError) throw updateError;
      setStatus('Template updated.');
      await loadTemplates();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function loadTemplateIntoEditor(t: TemplateRow) {
    setTemplateId(t.id);
    setTemplateName(t.name);
    setSubject(t.subject);
    setSubjectVariants((t.subject_variants || []).join('\n'));
    setMessage(t.message);
  }

  async function getContactsForSend() {
    const selected = readyContacts.filter((b) => selectedContacts[b.id]);
    const unique = new Map<string, Business>();
    const limit = Math.max(1, Math.min(MAX_MESSAGE_BATCH_SIZE, Number(sendLimit || 50)));

    if (selected.length) {
      for (const business of selected) {
        const key = normalizeEmail(business.email);
        if (key && !unique.has(key)) unique.set(key, business);
      }
      return Array.from(unique.values()).slice(0, limit);
    }

    const cleanSearch = readySearch.trim().replace(/[%_]/g, '');
    let query = supabase
      .from('businesses')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('status', 'ready')
      .not('email', 'is', null)
      .neq('email', '')
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (cleanSearch) query = query.or(`name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,domain.ilike.%${cleanSearch}%,website.ilike.%${cleanSearch}%`);
    const { data, error: loadError } = await query;
    if (loadError) throw loadError;
    for (const business of (data || []) as Business[]) {
      const key = normalizeEmail(business.email);
      if (key && !unique.has(key)) unique.set(key, business);
    }
    return Array.from(unique.values()).slice(0, limit);
  }

  async function repairReadyContacts() {
    setBusy(true);
    setError('');
    try {
      const { data, error: repairError } = await supabase.rpc('mark_ready_emails_and_pending_no_email', { target_workspace: workspace.id });
      if (repairError) throw repairError;
      const row = Array.isArray(data) ? data[0] : data;
      setStatus(`Repaired routing. Ready-to-message with email: ${Number(row?.ready_count || 0).toLocaleString()}. Pending without email: ${Number(row?.pending_count || 0).toLocaleString()}.`);
      await loadReadyContacts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function buildContactPayload(business: Business, template: TemplateRow, index: number) {
    const subjects = splitSubjects(template.subject, template.subject_variants);
    return {
      id: business.id,
      businessId: business.id,
      name: business.name || '',
      businessName: business.name || '',
      email: normalizeEmail(business.email),
      subject: renderTemplate(subjects[index % Math.max(1, subjects.length)] || template.subject, business),
      message: renderTemplate(template.message, business),
      templateId: template.id,
      templateName: template.name,
      website: business.website || '',
      domain: business.domain || getDomain(business),
      source: business.source || 'scout_v814'
    };
  }

  async function markSenderPaused(account: GmailAccount, reason: string, pausedUntil?: string) {
    const until = pausedUntil || toDateTomorrow();
    await supabase.from('gmail_accounts').update({ status: 'limit_hit', paused_until: until, last_error: reason }).eq('workspace_id', workspace.id).eq('id', account.id);
  }

  async function logOutreachEvent(payload: Record<string, unknown>) {
    await supabase.from('outreach_events').insert({ workspace_id: workspace.id, ...payload });
  }

  async function persistSendOutcome(params: { business: Business; template: TemplateRow; account: GmailAccount; result: SendResult; batchId: string; subject: string; body: string; dryRun: boolean }) {
    const { business, template, account, result, batchId, subject: sentSubject, body, dryRun: isDryRun } = params;
    const status = String(result.status || '').toLowerCase();
    const isSent = status === 'sent';
    const sentAt = new Date().toISOString();
    const row = {
      workspace_id: workspace.id,
      business_id: business.id,
      template_id: template.id,
      gmail_account_id: account.id,
      batch_id: batchId,
      to_email: normalizeEmail(business.email),
      from_email: normalizeEmail(account.email),
      subject: sentSubject,
      body,
      provider_message_id: result.gmailMessageId || null,
      gmail_thread_id: result.gmailThreadId || null,
      status: isDryRun ? 'dry_run' : (status || 'unknown'),
      raw: result,
      sent_at: sentAt
    };
    const { error: insertError } = await supabase.from('sent_messages').insert(row);
    if (insertError) throw insertError;

    if (isSent && !isDryRun) {
      const raw = { ...(business.raw || {}), last_send: { batch_id: batchId, template_id: template.id, gmail_account_id: account.id, from_email: account.email, subject: sentSubject, gmail_message_id: result.gmailMessageId || '', gmail_thread_id: result.gmailThreadId || '', sent_at: sentAt } };
      const { error: updateError } = await supabase.from('businesses').update({ status: 'contacted', raw }).eq('workspace_id', workspace.id).eq('id', business.id);
      if (updateError) throw updateError;
      await supabase.from('scout_history').upsert({
        workspace_id: workspace.id,
        normalized_key: business.normalized_key,
        email: normalizeEmail(business.email),
        domain: business.domain || getDomain(business),
        website: business.website,
        name: business.name,
        phone: business.phone,
        source: 'gmail_api_send',
        campaign: batchId,
        status: 'contacted',
        raw: { template_id: template.id, gmail_account_id: account.id, gmail_message_id: result.gmailMessageId || '', gmail_thread_id: result.gmailThreadId || '' }
      }, { onConflict: 'workspace_id,normalized_key' });
      await supabase.from('gmail_accounts').update({ sent_today: Number(account.sent_today || 0) + 1, last_error: null }).eq('workspace_id', workspace.id).eq('id', account.id);
    }
  }

  async function sendBatch() {
    setBusy(true);
    setError('');
    setProgress(0);
    setLastResults([]);
    setSummary({ requested: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, stopped: false });
    try {
      if (!currentTemplate) throw new Error('Create or select a template first.');
      const contacts = await getContactsForSend();
      if (!contacts.length) throw new Error('No Ready-to-message contacts with email found. Import contacts with emails or run Ready Email Detection first.');
      let activeAccounts = accounts.filter((a) => selectedAccounts[a.id] && a.status === 'connected' && !isPaused(a) && (a.access_token || a.refresh_token));
      if (!activeAccounts.length) throw new Error('Select at least one connected Gmail account with OAuth tokens.');

      const batchId = `scout_v814_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error: batchError } = await supabase.from('outreach_batches').insert({
        id: batchId,
        workspace_id: workspace.id,
        template_id: currentTemplate.id,
        requested_count: contacts.length,
        selected_sender_count: activeAccounts.length,
        status: dryRun ? 'dry_run' : 'running',
        raw: { selected_accounts: activeAccounts.map((a) => a.email), dryRun, delayMs }
      });
      if (batchError) throw batchError;

      const rowsForDownload: Array<Record<string, unknown>> = [];
      let cursor = 0;
      let attempted = 0;
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let stopped = false;
      const requested = contacts.length;

      setStatus(`Starting ${requested.toLocaleString()} message batch across ${activeAccounts.length.toLocaleString()} selected sender(s).`);

      for (let i = 0; i < contacts.length; i++) {
        if (!activeAccounts.length) {
          stopped = true;
          skipped += contacts.length - i;
          setStatus('All selected Gmail accounts are paused/limited. Remaining contacts stayed Ready.');
          break;
        }

        const business = contacts[i];
        const account = activeAccounts[cursor % activeAccounts.length];
        cursor += 1;
        const payload = buildContactPayload(business, currentTemplate, i);
        attempted += 1;
        setStatus(`Sending ${attempted.toLocaleString()} / ${requested.toLocaleString()} · ${account.email} → ${payload.email}`);

        const response = await fetch('/api/backend/email-scout/send-selected-batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contacts: [payload],
            limit: 1,
            delayMs,
            dryRun,
            senderEmail: account.email,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            client_id: account.client_id || googleClientId,
            expires_at: account.expires_at ? new Date(account.expires_at).getTime() : undefined
          })
        });
        const json = await response.json().catch(() => ({}));
        const result = ((json?.results || [])[0] || {}) as SendResult;
        const statusText = String(result.status || (json?.success ? 'sent' : 'failed')).toLowerCase();
        const limitHit = isLimitPayload(json, result);

        if (json?.access_token) {
          await supabase.from('gmail_accounts').update({ access_token: json.access_token }).eq('workspace_id', workspace.id).eq('id', account.id);
          account.access_token = json.access_token;
        }

        if (!response.ok && limitHit) {
          const reason = json?.error || result.reason || `Gmail limit reached for ${account.email}`;
          await markSenderPaused(account, reason, String(json?.senderPausedUntil || result.pausedUntil || ''));
          await logOutreachEvent({ batch_id: batchId, business_id: business.id, gmail_account_id: account.id, template_id: currentTemplate.id, type: 'sender_limit', message: reason, raw: json });
          rowsForDownload.push({ business: business.name, email: business.email, sender: account.email, status: 'not_sent_sender_limit', reason });
          activeAccounts = activeAccounts.filter((a) => a.id !== account.id);
          failed += 1;
          i -= 1;
          if (!activeAccounts.length) {
            stopped = true;
            skipped += contacts.length - i - 1;
            break;
          }
          continue;
        }

        if (!response.ok || json?.success === false) {
          const reason = json?.error || result.reason || `Send failed with HTTP ${response.status}`;
          failed += 1;
          rowsForDownload.push({ business: business.name, email: business.email, sender: account.email, status: 'failed', reason });
          await persistSendOutcome({ business, template: currentTemplate, account, result: { ...result, status: 'failed', reason }, batchId, subject: payload.subject, body: payload.message, dryRun });
          await logOutreachEvent({ batch_id: batchId, business_id: business.id, gmail_account_id: account.id, template_id: currentTemplate.id, type: 'send_failed', message: reason, raw: json });
        } else if (statusText === 'sent' || statusText === 'dry_run') {
          if (statusText === 'sent') sent += 1; else skipped += 1;
          rowsForDownload.push({ business: business.name, email: business.email, sender: account.email, status: statusText, subject: payload.subject, gmailMessageId: result.gmailMessageId || '' });
          await persistSendOutcome({ business, template: currentTemplate, account, result: { ...result, status: statusText }, batchId, subject: payload.subject, body: payload.message, dryRun });
          await logOutreachEvent({ batch_id: batchId, business_id: business.id, gmail_account_id: account.id, template_id: currentTemplate.id, type: statusText, message: `${statusText}: ${payload.email}`, raw: result });
        } else {
          skipped += 1;
          const reason = result.reason || statusText || 'not_sent';
          rowsForDownload.push({ business: business.name, email: business.email, sender: account.email, status: statusText, reason });
          await persistSendOutcome({ business, template: currentTemplate, account, result: { ...result, status: statusText }, batchId, subject: payload.subject, body: payload.message, dryRun });
        }

        setProgress(Math.round(((i + 1) / contacts.length) * 100));
        setSummary({ requested, attempted, sent, failed, skipped, stopped });
      }

      const finalStatus = stopped ? 'stopped' : dryRun ? 'dry_run_complete' : 'complete';
      await supabase.from('outreach_batches').update({ status: finalStatus, attempted_count: attempted, sent_count: sent, failed_count: failed, skipped_count: skipped, finished_at: new Date().toISOString() }).eq('workspace_id', workspace.id).eq('id', batchId);
      setLastResults(rowsForDownload);
      setProgress(100);
      setSummary({ requested, attempted, sent, failed, skipped, stopped });
      setSelectedContacts({});
      setStatus(`Batch ${finalStatus}. Requested: ${requested}, attempted: ${attempted}, sent: ${sent}, failed: ${failed}, skipped/not sent: ${skipped}. Unsent contacts stayed Ready.`);
      await Promise.all([loadReadyContacts(), loadAccounts(), loadPerformance()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleAllContacts(value: boolean) {
    if (!value) return setSelectedContacts({});
    setSelectedContacts(Object.fromEntries(readyContacts.map((b) => [b.id, true])));
  }

  function templatePerformance() {
    return templates.map((template) => {
      const sentRows = recentSent.filter((row) => row.template_id === template.id && row.status === 'sent');
      const realReplies = replies.filter((row) => row.template_id === template.id && row.is_real_reply !== false);
      return { template, sent: sentRows.length, replies: realReplies.length, perReply: realReplies.length ? (sentRows.length / realReplies.length).toFixed(1) : '-' };
    });
  }

  function accountPerformance() {
    return accounts.map((account) => {
      const sentRows = recentSent.filter((row) => row.gmail_account_id === account.id && row.status === 'sent');
      const realReplies = replies.filter((row) => row.gmail_account_id === account.id && row.is_real_reply !== false);
      return { account, sent: sentRows.length, replies: realReplies.length, perReply: realReplies.length ? (sentRows.length / realReplies.length).toFixed(1) : '-' };
    });
  }

  const previewSubject = currentTemplate && previewBusiness ? renderTemplate(splitSubjects(currentTemplate.subject, currentTemplate.subject_variants)[0] || currentTemplate.subject, previewBusiness) : '';
  const previewBody = currentTemplate && previewBusiness ? renderTemplate(currentTemplate.message, previewBusiness) : '';

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Ready To Message</div><div className="num">{readyTotal.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Connected Senders</div><div className="num">{accounts.filter((a) => a.status === 'connected' && !isPaused(a)).length.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Recent Sent Logs</div><div className="num">{recentSent.filter((r) => r.status === 'sent').length.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{replies.filter((r) => r.is_real_reply !== false).length.toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Backend + Gmail</h3>
            <p className="muted" style={{ marginBottom: 0 }}>Gmail OAuth and Gmail API sending run through your backend. This Node app controls templates, selected senders, sender rotation, limits, and Supabase tracking.</p>
          </div>
          <button className="btn secondary" type="button" onClick={checkBackend} disabled={busy}>Check Backend</button>
        </div>
        <div className="notice" style={{ marginTop: 12 }}>{backendNote || 'Backend status not checked yet.'}</div>
        {busy ? <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div> : null}
        <div className={error ? 'error' : 'success'} style={{ marginTop: 12 }}>{error || status}</div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Gmail Senders</h3>
          <p className="muted">Use <strong>Connect Gmail</strong>. You normally do not paste access tokens or refresh tokens; OAuth creates those behind the scenes so Gmail can send and read replies. Select only accounts that should join the rotation. If one hits a limit, it is removed immediately.</p>
          <label className="label">Google OAuth Client ID</label>
          <div className="actions">
            <input className="input" style={{ flex: 1, minWidth: 260 }} value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder="Google OAuth Client ID" />
            <button className="btn" type="button" onClick={startGmailOauth} disabled={busy}>Connect Gmail</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Authorized redirect URI in Google Cloud must be: <strong>{typeof window !== 'undefined' ? getMessageRedirectUri() : '/message'}</strong></p>

          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn secondary" type="button" onClick={() => setShowAdvancedTokens((value) => !value)}>{showAdvancedTokens ? 'Hide Advanced Sender Setup' : 'Advanced: Manual Sender Setup'}</button>
          </div>
          {showAdvancedTokens ? <div className="card" style={{ padding: 14, marginTop: 12 }}>
            <p className="muted">Advanced fallback only. Use this only if the backend returned tokens manually. For normal use, click Connect Gmail instead.</p>
            <div className="grid grid-2" style={{ marginTop: 14 }}>
              <div><label className="label">Manual sender email</label><input className="input" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="sender@gmail.com" /></div>
              <div><label className="label">Client ID</label><input className="input" value={manualClientId} onChange={(e) => setManualClientId(e.target.value)} placeholder="optional if saved above" /></div>
            </div>
            <label className="label" style={{ marginTop: 10 }}>Access token</label>
            <input className="input" value={manualAccessToken} onChange={(e) => setManualAccessToken(e.target.value)} placeholder="advanced only" />
            <label className="label" style={{ marginTop: 10 }}>Refresh token</label>
            <input className="input" value={manualRefreshToken} onChange={(e) => setManualRefreshToken(e.target.value)} placeholder="advanced only" />
            <div className="actions" style={{ marginTop: 12 }}><button className="btn secondary" type="button" disabled={busy} onClick={addManualAccount}>Add / Update Sender</button></div>
          </div> : null}

          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Use</th><th>Email</th><th>Status</th><th>Sent Today</th><th>Action</th></tr></thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td><input type="checkbox" disabled={account.status !== 'connected' || isPaused(account)} checked={!!selectedAccounts[account.id]} onChange={(e) => setSelectedAccounts((cur) => ({ ...cur, [account.id]: e.target.checked }))} /></td>
                    <td><strong>{account.email}</strong><br /><span className="muted">{account.last_error || (account.paused_until ? `Paused until ${new Date(account.paused_until).toLocaleString()}` : 'Ready')}</span></td>
                    <td><span className={`status ${account.status}`}>{isPaused(account) ? 'paused' : account.status}</span></td>
                    <td>{Number(account.sent_today || 0).toLocaleString()}</td>
                    <td><button className="btn secondary" type="button" disabled={busy || !(account.access_token || account.refresh_token)} onClick={() => verifySenderProfile(account)}>Verify Profile</button></td>
                  </tr>
                ))}
                {!accounts.length ? <tr><td colSpan={5} className="muted">No Gmail senders connected yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Templates</h3>
          <p className="muted">Use shortcodes like {'{name}'}, {'{business}'}, {'{category}'}, {'{location}'}, {'{website}'}, {'{domain}'}, {'{email}'}.</p>
          <div className="grid grid-2">
            <div><label className="label">Template</label><select className="select" value={templateId} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) loadTemplateIntoEditor(t); else setTemplateId(e.target.value); }}><option value="">Select template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label className="label">Name</label><input className="input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} /></div>
          </div>
          <label className="label" style={{ marginTop: 10 }}>Primary subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="label" style={{ marginTop: 10 }}>Extra subject variants, one per line</label>
          <textarea className="textarea" style={{ minHeight: 80 }} value={subjectVariants} onChange={(e) => setSubjectVariants(e.target.value)} />
          <label className="label" style={{ marginTop: 10 }}>Message</label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={saveTemplate} disabled={busy}>Save New Template</button>
            <button className="btn secondary" type="button" onClick={updateTemplateFromEditor} disabled={busy || !currentTemplate}>Update Selected</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Batch Send</h3>
        <div className="grid grid-4">
          <div><label className="label">Fixed number to send</label><input className="input" type="number" min={1} max={MAX_MESSAGE_BATCH_SIZE} value={sendLimit} onChange={(e) => setSendLimit(Number(e.target.value || 50))} /><p className="muted" style={{ fontSize: 12 }}>If no contacts are selected, Scout pulls the next Ready-to-message contacts from Supabase, not only the 100-row preview.</p></div>
          <div><label className="label">Delay per email/ms</label><input className="input" type="number" min={0} max={60000} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value || 0))} /></div>
          <div><label className="label">Selected contacts</label><div className="badge">{selectedContactIds.length ? selectedContactIds.length.toLocaleString() : 'Auto next Ready'}</div></div>
          <div><label className="label">Selected senders</label><div className="badge">{selectedAccountIds.length.toLocaleString()}</div></div>
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run only. Prepare/log without sending real Gmail messages.</label>
        <div className="actions">
          <button className="btn" type="button" onClick={sendBatch} disabled={busy || loading}>Start Fixed Batch</button>
          <button className="btn secondary" type="button" onClick={refreshAll} disabled={busy || loading}>Refresh</button>
          <button className="btn secondary" type="button" onClick={repairReadyContacts} disabled={busy || loading}>Repair Ready List</button>
          <button className="btn secondary" type="button" disabled={!lastResults.length} onClick={() => downloadCsv('scout-message-last-send-results.csv', lastResults)}>Download Last Results</button>
        </div>
        <div className="grid grid-4" style={{ marginTop: 14 }}>
          <div className="card kpi"><div className="title">Requested</div><div className="num">{summary.requested}</div></div>
          <div className="card kpi"><div className="title">Attempted</div><div className="num">{summary.attempted}</div></div>
          <div className="card kpi"><div className="title">Sent</div><div className="num">{summary.sent}</div></div>
          <div className="card kpi"><div className="title">Failed/Skipped</div><div className="num">{summary.failed + summary.skipped}</div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Ready To Message</h3>
            <div className="actions"><input className="input" style={{ width: 260 }} value={readySearch} onChange={(e) => setReadySearch(e.target.value)} placeholder="Search ready contacts" onKeyDown={(e) => { if (e.key === 'Enter') loadReadyContacts(); }} /><button className="btn secondary" type="button" onClick={loadReadyContacts}>Search</button></div>
          </div>
          <div className="actions" style={{ marginBottom: 12 }}><label className="checkbox-row" style={{ margin: 0 }}><input type="checkbox" checked={readyContacts.length > 0 && selectedContactIds.length === readyContacts.length} onChange={(e) => toggleAllContacts(e.target.checked)} /> Select current page</label><span className="badge">Showing {readyContacts.length.toLocaleString()} of {readyTotal.toLocaleString()} ready-to-message</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Use</th><th>Business</th><th>Email</th><th>Website</th></tr></thead>
              <tbody>
                {readyContacts.map((b) => <tr key={b.id}><td><input type="checkbox" checked={!!selectedContacts[b.id]} onChange={(e) => setSelectedContacts((cur) => ({ ...cur, [b.id]: e.target.checked }))} /></td><td><strong>{b.name || '-'}</strong><br /><span className="muted">{b.category || ''} {b.location ? `· ${b.location}` : ''}</span></td><td>{b.email}</td><td>{b.website || b.domain || '-'}</td></tr>)}
                {!readyContacts.length ? <tr><td colSpan={4} className="muted">No Ready-to-message contacts found. Import contacts with emails, run Ready Email Detection, or click Repair Ready List.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Message Preview</h3>
          {previewBusiness && currentTemplate ? <>
            <p className="muted">Previewing with: <strong>{previewBusiness.name || previewBusiness.email}</strong></p>
            <label className="label">Subject</label>
            <div className="notice">{previewSubject}</div>
            <label className="label" style={{ marginTop: 12 }}>Body</label>
            <div className="card" style={{ padding: 14, whiteSpace: 'pre-wrap' }}>{previewBody}</div>
          </> : <p className="muted">Select a template and load Ready-to-message contacts to preview.</p>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Template Performance</h3>
          <div className="table-wrap"><table><thead><tr><th>Template</th><th>Sent</th><th>Real Replies</th><th>Emails / Reply</th></tr></thead><tbody>
            {templatePerformance().map((row) => <tr key={row.template.id}><td>{row.template.name}</td><td>{row.sent}</td><td>{row.replies}</td><td>{row.perReply}</td></tr>)}
            {!templates.length ? <tr><td colSpan={4} className="muted">No templates yet.</td></tr> : null}
          </tbody></table></div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3>Sender Performance</h3>
          <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Sent</th><th>Real Replies</th><th>Emails / Reply</th></tr></thead><tbody>
            {accountPerformance().map((row) => <tr key={row.account.id}><td>{row.account.email}</td><td>{row.sent}</td><td>{row.replies}</td><td>{row.perReply}</td></tr>)}
            {!accounts.length ? <tr><td colSpan={4} className="muted">No sender accounts yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}
