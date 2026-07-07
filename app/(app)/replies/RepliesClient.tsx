'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GmailAccount, MessageTemplate, Workspace } from '@/lib/types';

const SYNC_ENDPOINTS = [
  '/api/backend/email-scout/check-replies',
  '/api/backend/replies/sync',
  '/api/backend/gmail/replies'
];

type ReplyRow = {
  id: string;
  business_id?: string | null;
  from_email?: string | null;
  to_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  classification?: string | null;
  is_real_reply?: boolean | null;
  received_at?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  batch_id?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
  raw?: Record<string, unknown> | null;
};

type SentRow = {
  id: string;
  business_id?: string | null;
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  batch_id?: string | null;
  provider_message_id?: string | null;
  gmail_thread_id?: string | null;
  delivery_status?: string | null;
  sent_at?: string | null;
};

type NoInboxRow = {
  id: string;
  business_id?: string | null;
  email?: string | null;
  reason?: string | null;
  created_at?: string | null;
  raw?: Record<string, unknown> | null;
};

type NormalizedMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: string;
  raw: Record<string, unknown>;
};

type SyncStats = {
  scanned: number;
  realReplies: number;
  noInbox: number;
  ignored: number;
  inserted: number;
  errors: string[];
};

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

function normalizeEmail(value: unknown) {
  const raw = String(value || '').toLowerCase().replace(/<([^>]+)>/g, ' $1 ');
  const match = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] || '';
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
}

function extractArray(json: any): any[] {
  const candidates = [json?.replies, json?.messages, json?.results, json?.items, json?.data, json?.emails, json?.threads];
  for (const item of candidates) if (Array.isArray(item)) return item;
  if (Array.isArray(json)) return json;
  return [];
}

function normalizeMessage(input: any, account: GmailAccount): NormalizedMessage {
  const raw = (input && typeof input === 'object' ? input : { value: input }) as Record<string, unknown>;
  const headers = (raw.headers || {}) as Record<string, unknown>;
  const from = normalizeEmail(raw.from_email || raw.from || headers.from || raw.sender || raw.replyFrom);
  const to = normalizeEmail(raw.to_email || raw.to || headers.to || raw.recipient || account.email);
  const subject = asText(raw.subject || headers.subject || raw.title || '');
  const snippet = asText(raw.snippet || raw.preview || raw.textSnippet || raw.summary || '');
  const body = asText(raw.body || raw.text || raw.html || raw.message || raw.payload || '');
  const receivedAt = asText(raw.received_at || raw.receivedAt || raw.date || raw.internalDate || raw.created_at) || new Date().toISOString();
  const gmailMessageId = asText(raw.gmail_message_id || raw.gmailMessageId || raw.message_id || raw.messageId || raw.id) || `${from}-${subject}-${receivedAt}`;
  const gmailThreadId = asText(raw.gmail_thread_id || raw.gmailThreadId || raw.thread_id || raw.threadId || raw.thread || '');
  return { gmailMessageId, gmailThreadId, fromEmail: from, toEmail: to, subject, snippet, body, receivedAt, raw };
}

function classify(message: NormalizedMessage) {
  const text = `${message.fromEmail} ${message.subject} ${message.snippet} ${message.body}`.toLowerCase();
  const bounceTerms = [
    'mailer-daemon', 'mail delivery subsystem', 'delivery status notification', 'undeliverable', 'message not delivered',
    'delivery incomplete', 'address not found', 'recipient address rejected', 'no such user', 'user unknown',
    'mailbox unavailable', 'mailbox full', 'over quota', '550 ', '5.1.1', '5.2.2', 'permanent failure', 'delivery failed'
  ];
  const limitTerms = ['sending limit', 'rate limit', 'quota exceeded', 'daily user sending quota exceeded', 'too many messages', 'user-rate limit'];
  const autoTerms = ['out of office', 'automatic reply', 'auto-reply', 'vacation responder', 'autoreply'];
  if (limitTerms.some((term) => text.includes(term))) return { classification: 'gmail_limit_notice', isReal: false, noInbox: false };
  if (bounceTerms.some((term) => text.includes(term))) return { classification: 'no_inbox_or_bounce', isReal: false, noInbox: true };
  if (autoTerms.some((term) => text.includes(term))) return { classification: 'auto_reply_ignored', isReal: false, noInbox: false };
  return { classification: 'real_reply', isReal: true, noInbox: false };
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
  const lines = [headers.map(csvEscape).join(',')];
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

export default function RepliesClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [sentRows, setSentRows] = useState<SentRow[]>([]);
  const [replyRows, setReplyRows] = useState<ReplyRow[]>([]);
  const [noInboxRows, setNoInboxRows] = useState<NoInboxRow[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, boolean>>({});
  const [syncLimit, setSyncLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Sync replies from selected Gmail accounts. Only real prospect replies count as responses. Bounces/no-inbox are separated.');
  const [error, setError] = useState('');
  const [lastStats, setLastStats] = useState<SyncStats>({ scanned: 0, realReplies: 0, noInbox: 0, ignored: 0, inserted: 0, errors: [] });

  async function loadAll() {
    setError('');
    const [acct, tmpl, sent, replies, noInbox] = await Promise.all([
      supabase.from('gmail_accounts').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('templates').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
      supabase.from('sent_messages').select('id,business_id,to_email,from_email,subject,template_id,gmail_account_id,batch_id,provider_message_id,gmail_thread_id,delivery_status,sent_at').eq('workspace_id', workspace.id).order('sent_at', { ascending: false }).limit(1000),
      supabase.from('reply_history').select('*').eq('workspace_id', workspace.id).order('received_at', { ascending: false }).limit(300),
      supabase.from('no_inbox_records').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(300)
    ]);
    const firstError = acct.error || tmpl.error || sent.error || replies.error || noInbox.error;
    if (firstError) throw firstError;
    const nextAccounts = (acct.data || []) as GmailAccount[];
    setAccounts(nextAccounts);
    setTemplates((tmpl.data || []) as MessageTemplate[]);
    setSentRows((sent.data || []) as SentRow[]);
    setReplyRows((replies.data || []) as ReplyRow[]);
    setNoInboxRows((noInbox.data || []) as NoInboxRow[]);
    setSelectedAccounts((current) => {
      const next: Record<string, boolean> = {};
      for (const account of nextAccounts) next[account.id] = current[account.id] ?? account.status === 'connected';
      return next;
    });
  }

  useEffect(() => {
    loadAll().catch((err) => setError(formatError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  function matchSent(message: NormalizedMessage): SentRow | undefined {
    if (message.gmailThreadId) {
      const byThread = sentRows.find((row) => row.gmail_thread_id && row.gmail_thread_id === message.gmailThreadId);
      if (byThread) return byThread;
    }
    const from = normalizeEmail(message.fromEmail);
    return sentRows.find((row) => normalizeEmail(row.to_email) === from) || sentRows.find((row) => normalizeEmail(row.to_email) && message.body.toLowerCase().includes(String(row.to_email).toLowerCase()));
  }

  async function fetchBackendReplies(account: GmailAccount) {
    let lastError = '';
    for (const endpoint of SYNC_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: workspace.id,
            accountId: account.id,
            accountEmail: account.email,
            email: account.email,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            client_id: account.client_id,
            limit: Math.max(1, Math.min(500, syncLimit))
          })
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json?.success === false) {
          lastError = json?.error || json?.message || `${endpoint} returned HTTP ${response.status}`;
          continue;
        }
        return extractArray(json).map((item) => normalizeMessage(item, account));
      } catch (err) {
        lastError = formatError(err);
      }
    }
    throw new Error(lastError || 'No backend reply-sync endpoint responded successfully.');
  }

  async function saveMessage(account: GmailAccount, message: NormalizedMessage, sentMatch?: SentRow) {
    const c = classify(message);
    const replyPayload = {
      workspace_id: workspace.id,
      business_id: sentMatch?.business_id || null,
      sent_message_id: sentMatch?.id || null,
      template_id: sentMatch?.template_id || null,
      gmail_account_id: sentMatch?.gmail_account_id || account.id,
      batch_id: sentMatch?.batch_id || null,
      from_email: message.fromEmail,
      to_email: message.toEmail || account.email,
      subject: message.subject,
      snippet: message.snippet || message.body.slice(0, 240),
      body: message.body,
      classification: c.classification,
      is_real_reply: c.isReal,
      received_at: message.receivedAt,
      gmail_message_id: message.gmailMessageId,
      gmail_thread_id: message.gmailThreadId || sentMatch?.gmail_thread_id || null,
      raw: message.raw
    };

    const { error: replyError } = await supabase
      .from('reply_history')
      .upsert(replyPayload, { onConflict: 'workspace_id,gmail_message_id' });
    if (replyError) throw replyError;

    if (sentMatch?.id) {
      await supabase.from('sent_messages').update({ delivery_status: c.noInbox ? 'no_inbox' : c.isReal ? 'replied' : c.classification }).eq('workspace_id', workspace.id).eq('id', sentMatch.id);
    }

    if (c.isReal && sentMatch?.business_id) {
      await supabase.from('businesses').update({ status: 'responded' }).eq('workspace_id', workspace.id).eq('id', sentMatch.business_id);
    }

    if (c.noInbox) {
      await supabase.from('no_inbox_records').insert({
        workspace_id: workspace.id,
        business_id: sentMatch?.business_id || null,
        email: message.fromEmail || sentMatch?.to_email || null,
        reason: c.classification,
        raw: message.raw
      });
      if (sentMatch?.business_id) await supabase.from('businesses').update({ status: 'no_inbox' }).eq('workspace_id', workspace.id).eq('id', sentMatch.business_id);
    }

    return c;
  }

  async function syncReplies() {
    const selected = accounts.filter((account) => selectedAccounts[account.id] && account.status === 'connected');
    if (!selected.length) {
      setError('Select at least one connected Gmail account first.');
      return;
    }
    setBusy(true);
    setError('');
    const stats: SyncStats = { scanned: 0, realReplies: 0, noInbox: 0, ignored: 0, inserted: 0, errors: [] };
    try {
      setStatus(`Syncing replies from ${selected.length} Gmail account(s)...`);
      for (const account of selected) {
        try {
          setStatus(`Checking ${account.email} for replies and bounces...`);
          const messages = await fetchBackendReplies(account);
          for (const message of messages) {
            stats.scanned += 1;
            const sentMatch = matchSent(message);
            const c = await saveMessage(account, message, sentMatch);
            stats.inserted += 1;
            if (c.isReal) stats.realReplies += 1;
            else if (c.noInbox) stats.noInbox += 1;
            else stats.ignored += 1;
          }
        } catch (err) {
          stats.errors.push(`${account.email}: ${formatError(err)}`);
        }
      }
      setLastStats(stats);
      setStatus(`Reply sync finished. Scanned ${stats.scanned}, real replies ${stats.realReplies}, no-inbox/bounce ${stats.noInbox}, ignored ${stats.ignored}.`);
      if (stats.errors.length) setError(stats.errors.join('\n'));
      await loadAll();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function templatePerformance() {
    return templates.map((template) => {
      const sent = sentRows.filter((row) => row.template_id === template.id).length;
      const realReplies = replyRows.filter((row) => row.template_id === template.id && row.is_real_reply === true).length;
      const ignored = replyRows.filter((row) => row.template_id === template.id && row.is_real_reply === false).length;
      return { template, sent, realReplies, ignored, perReply: realReplies ? (sent / realReplies).toFixed(1) : '-' };
    });
  }

  function senderPerformance() {
    return accounts.map((account) => {
      const sent = sentRows.filter((row) => row.gmail_account_id === account.id).length;
      const realReplies = replyRows.filter((row) => row.gmail_account_id === account.id && row.is_real_reply === true).length;
      const noInbox = noInboxRows.filter((row) => normalizeEmail(row.email) && sentRows.some((sent) => sent.gmail_account_id === account.id && normalizeEmail(sent.to_email) === normalizeEmail(row.email))).length;
      return { account, sent, realReplies, noInbox, perReply: realReplies ? (sent / realReplies).toFixed(1) : '-' };
    });
  }

  const realReplies = replyRows.filter((row) => row.is_real_reply === true);
  const ignoredReplies = replyRows.filter((row) => row.is_real_reply === false);
  const sentCount = sentRows.length;

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Sent Tracked</div><div className="num">{sentCount.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{realReplies.length.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">No Inbox / Bounce</div><div className="num">{noInboxRows.length.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Emails Per Reply</div><div className="num">{realReplies.length ? (sentCount / realReplies.length).toFixed(1) : '-'}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>Reply Sync</h3>
            <p className="muted" style={{ marginBottom: 0 }}>Counts only real prospect replies. Mailer-daemon, bounces, no-inbox, out-of-office, and Gmail limit notices are ignored or moved to No Inbox.</p>
          </div>
          <button className="btn secondary" onClick={() => loadAll().catch((err) => setError(formatError(err)))} disabled={busy}>Refresh</button>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label className="label">Gmail accounts to check</label>
            <div className="stack">
              {accounts.map((account) => (
                <label className="checkbox-row" key={account.id}>
                  <input type="checkbox" checked={!!selectedAccounts[account.id]} onChange={(event) => setSelectedAccounts((current) => ({ ...current, [account.id]: event.target.checked }))} />
                  {account.email} · {account.status}
                </label>
              ))}
              {!accounts.length ? <div className="muted">No Gmail accounts saved yet. Add senders from Message first.</div> : null}
            </div>
          </div>
          <div>
            <label className="label">Max messages per account</label>
            <input className="input" type="number" min={1} max={500} value={syncLimit} onChange={(event) => setSyncLimit(Number(event.target.value || 100))} />
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={syncReplies}>{busy ? 'Syncing...' : 'Sync selected accounts'}</button>
              {replyRows.length ? <button className="btn secondary" type="button" onClick={() => downloadCsv('scout-real-replies.csv', realReplies as unknown as Array<Record<string, unknown>>)}>Export real replies</button> : null}
              {noInboxRows.length ? <button className="btn secondary" type="button" onClick={() => downloadCsv('scout-no-inbox.csv', noInboxRows as unknown as Array<Record<string, unknown>>)}>Export no inbox</button> : null}
            </div>
          </div>
        </div>
        <div className={error ? 'error' : 'notice'} style={{ whiteSpace: 'pre-wrap' }}>{error || status}</div>
      </div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Last Sync Scanned</div><div className="num">{lastStats.scanned.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Last Sync Real</div><div className="num">{lastStats.realReplies.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Last Sync No Inbox</div><div className="num">{lastStats.noInbox.toLocaleString()}</div></div>
        <div className="card kpi"><div className="title">Last Sync Ignored</div><div className="num">{lastStats.ignored.toLocaleString()}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Template Response Tracking</h3>
        <div className="table-wrap"><table><thead><tr><th>Template</th><th>Sent</th><th>Real Replies</th><th>Ignored / Bounce</th><th>Emails Per Reply</th></tr></thead><tbody>
          {templatePerformance().map((row) => <tr key={row.template.id}><td>{row.template.name}</td><td>{row.sent}</td><td>{row.realReplies}</td><td>{row.ignored}</td><td>{row.perReply}</td></tr>)}
          {!templates.length ? <tr><td colSpan={5} className="muted">No templates yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Sender Response Tracking</h3>
        <div className="table-wrap"><table><thead><tr><th>Sender</th><th>Status</th><th>Sent</th><th>Real Replies</th><th>No Inbox</th><th>Emails Per Reply</th></tr></thead><tbody>
          {senderPerformance().map((row) => <tr key={row.account.id}><td>{row.account.email}</td><td>{row.account.status}</td><td>{row.sent}</td><td>{row.realReplies}</td><td>{row.noInbox}</td><td>{row.perReply}</td></tr>)}
          {!accounts.length ? <tr><td colSpan={6} className="muted">No senders yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Real Replies</h3>
        <div className="table-wrap"><table><thead><tr><th>From</th><th>Subject</th><th>Snippet</th><th>Template</th><th>Received</th></tr></thead><tbody>
          {realReplies.slice(0, 100).map((r) => <tr key={r.id}><td>{r.from_email || '-'}</td><td>{r.subject || '-'}</td><td>{r.snippet || '-'}</td><td>{templates.find((t) => t.id === r.template_id)?.name || '-'}</td><td>{r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</td></tr>)}
          {!realReplies.length ? <tr><td colSpan={5} className="muted">No real replies yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Ignored / No Inbox Signals</h3>
        <div className="table-wrap"><table><thead><tr><th>From</th><th>Subject</th><th>Classification</th><th>Counts as Response?</th><th>Received</th></tr></thead><tbody>
          {ignoredReplies.slice(0, 100).map((r) => <tr key={r.id}><td>{r.from_email || '-'}</td><td>{r.subject || '-'}</td><td>{r.classification || '-'}</td><td>No</td><td>{r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</td></tr>)}
          {!ignoredReplies.length ? <tr><td colSpan={5} className="muted">No ignored/bounce records yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
