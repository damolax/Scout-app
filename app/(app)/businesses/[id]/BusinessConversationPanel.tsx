'use client';

import { useMemo, useState } from 'react';
import type { GmailAccount, Workspace } from '@/lib/types';

type AnyRow = Record<string, any>;

type Props = {
  workspace: Workspace;
  business: AnyRow;
  accounts: GmailAccount[];
  sentRows: AnyRow[];
  replyRows: AnyRow[];
  noInboxRows: AnyRow[];
  socialLinks: string[];
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function nice(value: unknown) {
  return text(value) || '-';
}

function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return '-';
  try { return new Date(raw).toLocaleString(); } catch { return raw; }
}

function rowTime(row: AnyRow) {
  return text(row.sent_at || row.received_at || row.created_at || row.updated_at);
}

function classifyLabel(row: AnyRow) {
  if (row.kind) return row.kind;
  if (row.is_real_reply || row.reply_bucket === 'real_reply') return 'real_reply';
  if (row.is_auto_reply || row.reply_bucket === 'auto_reply' || row.classification === 'auto_reply') return 'auto_reply';
  if (row.is_limit_notice || row.classification === 'gmail_limit_notice') return 'limit_notice';
  if (row.is_delivery_failure || ['no_inbox', 'message_blocked', 'bounce_notice'].includes(String(row.classification || row.reply_bucket || ''))) return String(row.classification || row.reply_bucket || 'delivery_failure');
  if (row.reason) return String(row.reason);
  return String(row.classification || row.delivery_status || 'message');
}

function subjectFromRows(sentRows: AnyRow[], replyRows: AnyRow[], businessName: string) {
  const latestReply = replyRows.find((row) => text(row.subject));
  const latestSent = sentRows.find((row) => text(row.subject));
  const subject = text(latestReply?.subject || latestSent?.subject || businessName || 'Follow up');
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
}

function latestThread(sentRows: AnyRow[], replyRows: AnyRow[]) {
  return text(replyRows.find((row) => text(row.gmail_thread_id))?.gmail_thread_id || sentRows.find((row) => text(row.gmail_thread_id))?.gmail_thread_id || '');
}

export default function BusinessConversationPanel({ workspace, business, accounts, sentRows, replyRows, noInboxRows, socialLinks }: Props) {
  const connectedAccounts = accounts.filter((account) => ['connected', 'ready'].includes(String(account.status || '')));
  const [accountId, setAccountId] = useState(connectedAccounts[0]?.id || '');
  const [toEmail, setToEmail] = useState(text(business.email));
  const [subject, setSubject] = useState(subjectFromRows(sentRows, replyRows, text(business.name)));
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const timeline = useMemo(() => {
    const sent = sentRows.map((row) => ({ ...row, kind: row.delivery_status === 'manual_reply_sent' ? 'manual_reply_sent' : 'sent', sortTime: rowTime(row) }));
    const replies = replyRows.map((row) => ({ ...row, kind: classifyLabel(row), sortTime: rowTime(row) }));
    const failures = noInboxRows.map((row) => ({ ...row, kind: classifyLabel(row), sortTime: rowTime(row), subject: row.subject, from_email: row.from_email, to_email: row.email || row.to_email }));
    return ([...sent, ...replies, ...failures] as AnyRow[]).sort((a, b) => new Date(rowTime(b)).getTime() - new Date(rowTime(a)).getTime());
  }, [sentRows, replyRows, noInboxRows]);

  const latestInbound = replyRows.find((row) => row.is_real_reply || row.is_auto_reply || row.reply_bucket === 'real_reply' || row.reply_bucket === 'auto_reply');
  const lastSent = sentRows[0];
  const threadId = latestThread(sentRows, replyRows);

  async function sendReply() {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/gmail/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          business_id: business.id,
          gmail_account_id: accountId,
          to: toEmail,
          subject,
          body,
          gmail_thread_id: threadId || undefined
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Reply failed with HTTP ${response.status}`);
      setNotice('Reply sent and saved to this business conversation. Refresh this page to see it in the timeline.');
      setBody('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-2">
      <div className="card" style={{ padding: 18 }}>
        <h3>Conversation Timeline</h3>
        <p className="muted">Real replies, auto replies, delivery failures, blocked notices, and your manual replies are shown separately so the business history is not mixed up.</p>
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <div className="notice"><strong>Last sent:</strong><br />{lastSent ? `${formatDate(lastSent.sent_at)} · ${nice(lastSent.subject)}` : 'No sent message yet.'}</div>
          <div className="notice"><strong>Latest inbound:</strong><br />{latestInbound ? `${formatDate(latestInbound.received_at)} · ${classifyLabel(latestInbound)}` : 'No inbound reply yet.'}</div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Type</th><th>Email</th><th>Subject</th><th>When</th></tr></thead><tbody>
          {timeline.slice(0, 80).map((row, index) => <tr key={`${row.kind}-${row.id || row.gmail_message_id || index}`}><td><span className={`status ${String(row.kind).replace(/_/g, '-')}`}>{String(row.kind).replace(/_/g, ' ')}</span></td><td>{nice(row.from_email || row.to_email || row.email)}</td><td>{nice(row.subject)}</td><td>{formatDate(rowTime(row))}</td></tr>)}
          {!timeline.length ? <tr><td colSpan={4} className="muted">No conversation history yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Reply From This Business</h3>
        <p className="muted">Use this when a business has replied or needs a direct follow-up. Scout will send through the selected Gmail and save the reply in this business record.</p>
        <label className="label">Sender Gmail</label>
        <select className="select" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {connectedAccounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
        </select>
        <label className="label">To</label>
        <input className="input" value={toEmail} onChange={(event) => setToEmail(event.target.value)} placeholder="prospect@example.com" />
        <label className="label">Subject</label>
        <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} />
        <label className="label">Message</label>
        <textarea className="textarea" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your reply here..." style={{ minHeight: 160 }} />
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={busy || !accountId || !toEmail || !subject || !body} onClick={sendReply}>{busy ? 'Sending...' : 'Send reply'}</button>
        </div>
        {notice ? <div className={notice.toLowerCase().includes('failed') || notice.toLowerCase().includes('error') ? 'error' : 'success'} style={{ marginTop: 12 }}>{notice}</div> : null}
        {!connectedAccounts.length ? <div className="error" style={{ marginTop: 12 }}>No connected Gmail account is available. Connect Gmail in Settings first.</div> : null}

        <hr />
        <h3>Business Context</h3>
        <table><tbody>
          <tr><th>Reply state</th><td>{nice(business.reply_state || business.last_reply_classification)}</td></tr>
          <tr><th>Last inbound</th><td>{formatDate(business.last_inbound_at)}</td></tr>
          <tr><th>Last auto reply</th><td>{formatDate(business.last_auto_reply_at)}</td></tr>
          <tr><th>Last real reply</th><td>{formatDate(business.last_real_reply_at)}</td></tr>
          <tr><th>Last manual reply</th><td>{formatDate(business.last_manual_reply_at)}</td></tr>
        </tbody></table>
        <h3 style={{ marginTop: 16 }}>Social / Profiles</h3>
        <div className="stack">
          {socialLinks.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}
          {!socialLinks.length ? <div className="muted">No social/profile links found in the imported raw data yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
