'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { GmailAccount, MessageTemplate, Workspace } from '@/lib/types';
import {
  compactReplyRows,
  isDeliveryOrLimitSignal,
  isUnifiedAutoReply,
  isUnifiedRealReply
} from '@/lib/reply-metrics';

type ReplyRow = {
  id: string;
  business_id?: string | null;
  from_email?: string | null;
  to_email?: string | null;
  subject?: string | null;
  snippet?: string | null;
  body?: string | null;
  classification?: string | null;
  is_real_reply?: boolean | null;
  is_auto_reply?: boolean | null;
  is_delivery_failure?: boolean | null;
  is_blocked?: boolean | null;
  is_limit_notice?: boolean | null;
  reply_bucket?: string | null;
  received_at?: string | null;
  template_id?: string | null;
  gmail_account_id?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
  raw?: Record<string, unknown> | null;
};

type NoInboxRow = {
  id: string;
  business_id?: string | null;
  email?: string | null;
  reason?: string | null;
  created_at?: string | null;
  raw?: Record<string, unknown> | null;
};

type BusinessSummary = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type TrackingCounts = {
  sentTracked: number;
  realReplies: number;
  autoReplies: number;
  deliveryProblems: number;
  totalInbound: number;
};

type ReplyFilter = 'real' | 'all';

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const item = error as { message?: string; code?: string; details?: string; hint?: string; error?: string; reason?: string };
    return [
      item.message || item.error,
      item.reason,
      item.code ? `Code: ${item.code}` : '',
      item.details,
      item.hint
    ].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
}

function fullReplyText(row: ReplyRow) {
  const raw = row.raw || {};
  const rawGmail = (raw as { gmail?: Record<string, unknown> }).gmail || {};
  return asText(row.body)
    || asText(row.snippet)
    || asText((raw as Record<string, unknown>).body)
    || asText((raw as Record<string, unknown>).text)
    || asText((raw as Record<string, unknown>).message)
    || asText(rawGmail.snippet)
    || 'No full message body was saved for this reply.';
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
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function signalLabel(row: ReplyRow) {
  if (isUnifiedRealReply(row)) return 'Real reply';
  if (isUnifiedAutoReply(row)) return 'Automatic';
  if (row.is_limit_notice || row.classification === 'gmail_limit_notice') return 'Gmail limit';
  if (isDeliveryOrLimitSignal(row)) return 'Delivery problem';
  return String(row.classification || row.reply_bucket || 'Other').replace(/_/g, ' ');
}

export default function RepliesClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [businesses, setBusinesses] = useState<Record<string, BusinessSummary>>({});
  const [replyRows, setReplyRows] = useState<ReplyRow[]>([]);
  const [noInboxRows, setNoInboxRows] = useState<NoInboxRow[]>([]);
  const [counts, setCounts] = useState<TrackingCounts>({ sentTracked: 0, realReplies: 0, autoReplies: 0, deliveryProblems: 0, totalInbound: 0 });
  const [search, setSearch] = useState('');
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('real');
  const [templateFilter, setTemplateFilter] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openedReply, setOpenedReply] = useState<ReplyRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accountResult, templateResult, replyResult, noInboxResult, sentCountResult, realCountResult, autoCountResult, noInboxCountResult, metricsResponse] = await Promise.all([
        supabase.from('gmail_accounts').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
        supabase.from('templates').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }),
        supabase
          .from('reply_history')
          .select('id,business_id,from_email,to_email,subject,snippet,body,classification,is_real_reply,is_auto_reply,is_delivery_failure,is_blocked,is_limit_notice,reply_bucket,received_at,template_id,gmail_account_id,gmail_message_id,gmail_thread_id,raw')
          .eq('workspace_id', workspace.id)
          .order('received_at', { ascending: false })
          .limit(500),
        supabase.from('no_inbox_records').select('id,business_id,email,reason,created_at,raw').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('sent_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'sent'),
        supabase.from('reply_history').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('is_real_reply', true),
        supabase.from('reply_history').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).or('is_auto_reply.eq.true,reply_bucket.eq.auto_reply,classification.eq.auto_reply'),
        supabase.from('no_inbox_records').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
        fetch(`/api/replies/metrics?workspaceId=${encodeURIComponent(workspace.id)}`, { cache: 'no-store' })
          .then(async (response) => response.ok ? response.json() : null)
          .catch(() => null)
      ]);

      const firstError = accountResult.error
        || templateResult.error
        || replyResult.error
        || noInboxResult.error
        || sentCountResult.error
        || realCountResult.error
        || autoCountResult.error
        || noInboxCountResult.error;
      if (firstError) throw firstError;

      const nextReplies = (replyResult.data || []) as ReplyRow[];
      const nextNoInbox = (noInboxResult.data || []) as NoInboxRow[];
      const businessIds = Array.from(new Set(
        [...nextReplies, ...nextNoInbox]
          .map((row) => row.business_id)
          .filter((id): id is string => Boolean(id))
      ));

      let businessMap: Record<string, BusinessSummary> = {};
      if (businessIds.length) {
        const { data, error: businessError } = await supabase
          .from('businesses')
          .select('id,name,email')
          .eq('workspace_id', workspace.id)
          .in('id', businessIds);
        if (businessError) throw businessError;
        businessMap = Object.fromEntries(((data || []) as BusinessSummary[]).map((business) => [business.id, business]));
      }

      const metrics = metricsResponse && metricsResponse.success !== false ? metricsResponse : null;
      setAccounts((accountResult.data || []) as GmailAccount[]);
      setTemplates((templateResult.data || []) as MessageTemplate[]);
      setReplyRows(nextReplies);
      setNoInboxRows(nextNoInbox);
      setBusinesses(businessMap);
      setCounts({
        sentTracked: sentCountResult.count || 0,
        realReplies: Number(metrics?.realReplies ?? realCountResult.count ?? 0),
        autoReplies: Number(metrics?.autoReplies ?? autoCountResult.count ?? 0),
        deliveryProblems: Math.max(Number(metrics?.deliveryFailures || 0), noInboxCountResult.count || 0),
        totalInbound: Number(metrics?.totalInbound ?? nextReplies.length)
      });
    } catch (loadError) {
      setError(formatError(loadError));
    } finally {
      setLoading(false);
    }
  }, [supabase, workspace.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    setSyncStatus('Checking Scout-created Gmail threads…');
    try {
      const active = accounts.filter((account) => ['connected', 'ready', 'recovering'].includes(String(account.status || '').toLowerCase()));
      if (!active.length) throw new Error('Connect or reconnect at least one Gmail account first.');
      let saved = 0;
      let failures = 0;
      for (const account of active) {
        for (const endpoint of ['/api/gmail/sync-replies', '/api/gmail/sync-bounces']) {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace_id: workspace.id, gmail_account_id: account.id, max_results: 100, days: 30 }),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok || json.success === false) failures += 1;
          else saved += Number(json.saved || 0);
        }
      }
      await loadAll();
      setSyncStatus(`${saved.toLocaleString()} new record${saved === 1 ? '' : 's'} collected${failures ? ` · ${failures} check(s) need attention` : ''}.`);
    } catch (syncError) {
      setError(formatError(syncError));
      setSyncStatus('');
    } finally {
      setSyncing(false);
    }
  }, [accounts, loadAll, syncing, workspace.id]);

  const realReplies = useMemo(() => compactReplyRows(replyRows.filter(isUnifiedRealReply)), [replyRows]);
  const autoReplies = useMemo(() => compactReplyRows(replyRows.filter(isUnifiedAutoReply)), [replyRows]);
  const deliverySignals = useMemo(
    () => replyRows.filter((row) => isDeliveryOrLimitSignal(row)),
    [replyRows]
  );
  const otherSignals = useMemo(
    () => replyRows.filter((row) => !isUnifiedRealReply(row) && !isUnifiedAutoReply(row) && !isDeliveryOrLimitSignal(row)),
    [replyRows]
  );

  const visibleReplies = useMemo(() => {
    const source = replyFilter === 'real' ? realReplies : compactReplyRows(replyRows);
    const query = search.trim().toLowerCase();
    return source.filter((row) => {
      if (templateFilter && row.template_id !== templateFilter) return false;
      if (senderFilter && row.gmail_account_id !== senderFilter) return false;
      if (!query) return true;
      const business = row.business_id ? businesses[row.business_id] : undefined;
      const haystack = [
        business?.name,
        business?.email,
        row.from_email,
        row.to_email,
        row.subject,
        row.snippet,
        row.classification,
        row.reply_bucket
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }, [businesses, realReplies, replyFilter, replyRows, search, senderFilter, templateFilter]);

  function businessLabel(row: ReplyRow) {
    const business = row.business_id ? businesses[row.business_id] : undefined;
    return business?.name || business?.email || row.from_email || 'Unknown business';
  }

  function exportVisibleReplies() {
    const rows = visibleReplies.map((row) => ({
      business: businessLabel(row),
      from_email: row.from_email || '',
      to_email: row.to_email || '',
      subject: row.subject || '',
      snippet: row.snippet || '',
      type: signalLabel(row),
      template: templates.find((template) => template.id === row.template_id)?.name || '',
      sender: accounts.find((account) => account.id === row.gmail_account_id)?.email || '',
      received_at: row.received_at || ''
    }));
    downloadCsv('scout-visible-replies.csv', rows);
  }

  return (
    <div className="stack">
      {error ? (
        <div className="error">
          <strong>Replies could not be loaded.</strong><br />
          {error}
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn secondary mini" type="button" onClick={loadAll}>Try again</button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Real Replies</div><div className="num">{counts.realReplies.toLocaleString()}</div><p className="muted">Human-looking responses.</p></div>
        <div className="card kpi"><div className="title">Automatic</div><div className="num">{counts.autoReplies.toLocaleString()}</div><p className="muted">Tickets, receipts, and out-of-office messages.</p></div>
        <div className="card kpi"><div className="title">Delivery Problems</div><div className="num">{counts.deliveryProblems.toLocaleString()}</div><p className="muted">Bounces, blocks, and missing inboxes.</p></div>
        <div className="card kpi"><div className="title">Sent Tracked</div><div className="num">{counts.sentTracked.toLocaleString()}</div><p className="muted">Messages accepted by Gmail.</p></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 760 }}>
            <h3 style={{ margin: 0 }}>Reply inbox</h3>
            <p className="muted" style={{ margin: '6px 0 0' }}>Open a real reply, read the exact message, then continue from that business record.</p>
          </div>
          <div className="actions">
            <button className="btn" type="button" onClick={syncNow} disabled={syncing || loading}>{syncing ? 'Checking…' : 'Check replies now'}</button>
            <button className="btn secondary" type="button" onClick={loadAll} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
            <button className="btn secondary" type="button" onClick={exportVisibleReplies} disabled={!visibleReplies.length}>Export visible</button>
          </div>
        </div>

        <div className="notice" style={{ marginTop: 12 }}>
          <strong>Scoped Gmail collection is active:</strong> Scout checks only threads created by Scout-sent messages plus delivery-system notices related to Scout recipients. It does not import or display unrelated inbox conversations.
        </div>

        <div className="grid grid-4" style={{ marginTop: 14 }}>
          <div>
            <label className="label" htmlFor="reply-search">Search</label>
            <input id="reply-search" className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Business, email, or subject" />
          </div>
          <div>
            <label className="label" htmlFor="reply-type">Show</label>
            <select id="reply-type" className="select" value={replyFilter} onChange={(event) => setReplyFilter(event.target.value as ReplyFilter)}>
              <option value="real">Real replies</option>
              <option value="all">All stored messages</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reply-template">Template</label>
            <select id="reply-template" className="select" value={templateFilter} onChange={(event) => setTemplateFilter(event.target.value)}>
              <option value="">All templates</option>
              {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reply-sender">Sender</label>
            <select id="reply-sender" className="select" value={senderFilter} onChange={(event) => setSenderFilter(event.target.value)}>
              <option value="">All Gmail accounts</option>
              {accounts.map((account) => <option value={account.id} key={account.id}>{account.email}</option>)}
            </select>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 12 }}>
          Showing {visibleReplies.length.toLocaleString()} of {replyFilter === 'real' ? realReplies.length.toLocaleString() : replyRows.length.toLocaleString()} recent stored records. Official real-reply total: {counts.realReplies.toLocaleString()}.
        </p>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Reply</th><th>Type</th><th>Template</th><th>Sender</th><th>Received</th><th>Action</th></tr></thead>
            <tbody>
              {visibleReplies.slice(0, 150).map((row) => {
                const business = row.business_id ? businesses[row.business_id] : undefined;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{businessLabel(row)}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{business?.email || row.from_email || '-'}</div>
                    </td>
                    <td>
                      <strong>{row.subject || '(No subject)'}</strong>
                      <div className="muted" style={{ marginTop: 4, maxWidth: 440 }}>{row.snippet || 'No preview saved.'}</div>
                    </td>
                    <td><span className="badge">{signalLabel(row)}</span></td>
                    <td>{templates.find((template) => template.id === row.template_id)?.name || '-'}</td>
                    <td>{accounts.find((account) => account.id === row.gmail_account_id)?.email || '-'}</td>
                    <td>{formatDate(row.received_at)}</td>
                    <td>
                      <div className="actions">
                        <button className="btn secondary mini" type="button" onClick={() => setOpenedReply(row)}>Read</button>
                        {row.business_id ? <Link className="btn mini" href={`/businesses/${row.business_id}`}>Open & reply</Link> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !visibleReplies.length ? <tr><td colSpan={7} className="muted">No records match these filters.</td></tr> : null}
              {loading ? <tr><td colSpan={7} className="muted">Loading reply records...</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <details className="card" style={{ padding: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Automatic messages <span className="muted">· {autoReplies.length.toLocaleString()} recent</span></summary>
        <p className="muted">Ticket receipts, acknowledgements, feedback requests, and out-of-office messages are separated from real replies.</p>
        <div className="table-wrap"><table><thead><tr><th>Business</th><th>From</th><th>Subject</th><th>Received</th><th>Message</th></tr></thead><tbody>
          {autoReplies.slice(0, 100).map((row) => <tr key={row.id}><td>{businessLabel(row)}</td><td>{row.from_email || '-'}</td><td>{row.subject || '-'}</td><td>{formatDate(row.received_at)}</td><td><button className="btn secondary mini" type="button" onClick={() => setOpenedReply(row)}>Read</button></td></tr>)}
          {!autoReplies.length ? <tr><td colSpan={5} className="muted">No automatic messages stored.</td></tr> : null}
        </tbody></table></div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Delivery problems <span className="muted">· {Math.max(deliverySignals.length, noInboxRows.length).toLocaleString()} recent</span></summary>
        <div className="actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <p className="muted" style={{ margin: 0 }}>Bounces, blocked messages, missing inboxes, and Gmail limit notices do not count as replies.</p>
          <Link className="btn secondary mini" href="/no-inbox">Open bad inboxes</Link>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Business</th><th>Email</th><th>Reason</th><th>Received</th><th>Message</th></tr></thead><tbody>
          {deliverySignals.slice(0, 100).map((row) => <tr key={`reply-${row.id}`}><td>{businessLabel(row)}</td><td>{row.from_email || row.to_email || '-'}</td><td>{signalLabel(row)}</td><td>{formatDate(row.received_at)}</td><td><button className="btn secondary mini" type="button" onClick={() => setOpenedReply(row)}>Read</button></td></tr>)}
          {noInboxRows.slice(0, Math.max(0, 100 - deliverySignals.length)).map((row) => <tr key={`no-inbox-${row.id}`}><td>{row.business_id && businesses[row.business_id] ? businessLabel({ id: row.id, business_id: row.business_id, from_email: row.email }) : row.email || 'Unknown business'}</td><td>{row.email || '-'}</td><td>{String(row.reason || 'No inbox').replace(/_/g, ' ')}</td><td>{formatDate(row.created_at)}</td><td>-</td></tr>)}
          {!deliverySignals.length && !noInboxRows.length ? <tr><td colSpan={5} className="muted">No delivery problems stored.</td></tr> : null}
        </tbody></table></div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Other stored signals <span className="muted">· {otherSignals.length.toLocaleString()} recent</span></summary>
        <p className="muted">Unmatched or unclassified inbound records remain visible for review instead of being silently hidden.</p>
        <div className="table-wrap"><table><thead><tr><th>Business</th><th>From</th><th>Subject</th><th>Classification</th><th>Received</th><th>Message</th></tr></thead><tbody>
          {otherSignals.slice(0, 100).map((row) => <tr key={row.id}><td>{businessLabel(row)}</td><td>{row.from_email || '-'}</td><td>{row.subject || '-'}</td><td>{signalLabel(row)}</td><td>{formatDate(row.received_at)}</td><td><button className="btn secondary mini" type="button" onClick={() => setOpenedReply(row)}>Read</button></td></tr>)}
          {!otherSignals.length ? <tr><td colSpan={6} className="muted">No unmatched records stored.</td></tr> : null}
        </tbody></table></div>
      </details>

      {openedReply ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOpenedReply(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="actions" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>{businessLabel(openedReply)}</h3>
                <p className="muted" style={{ margin: '6px 0 0' }}>{openedReply.from_email || '-'} · {formatDate(openedReply.received_at)}</p>
              </div>
              <button className="btn secondary mini" type="button" onClick={() => setOpenedReply(null)}>Close</button>
            </div>
            <div className="notice" style={{ marginTop: 12 }}><strong>Subject:</strong> {openedReply.subject || '-'}</div>
            <pre className="message-body-view">{fullReplyText(openedReply)}</pre>
            {openedReply.business_id ? <Link className="btn" href={`/businesses/${openedReply.business_id}`}>Open business and reply</Link> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
