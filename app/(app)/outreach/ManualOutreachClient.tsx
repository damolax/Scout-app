'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import type { Business, GmailAccount, MessageTemplate, Workspace } from '@/lib/types';

type Prepared = { subject: string; message: string; source: string };

const SUBJECT_KEYS = [
  'subject','email subject','email_subject','message subject','message_subject',
  'outreach subject','outreach_subject','subject line','subject_line'
];
const MESSAGE_KEYS = [
  'first message','first_message','message','email message','email_message',
  'outreach message','outreach_message','message to author','message_to_author',
  'first message author language','first_message_author_language','body'
];

function normalizedEntries(raw: Record<string, unknown> | null | undefined) {
  return Object.entries(raw || {}).map(([key, value]) => [
    key.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
    String(value ?? '').trim(),
  ] as const);
}

function valueFor(raw: Record<string, unknown> | null | undefined, aliases: string[]) {
  const rows = normalizedEntries(raw);
  for (const alias of aliases) {
    const clean = alias.replace(/[^a-z0-9]+/g, ' ').toLowerCase().trim();
    const hit = rows.find(([key, value]) => key === clean && value);
    if (hit) return hit[1];
  }
  return '';
}

function render(text: string, business: Business) {
  const replacements: Record<string,string> = {
    name: business.name || '',
    author: business.name || '',
    business: business.name || '',
    company: business.name || '',
    email: business.email || '',
    website: business.website || '',
    country: business.location || '',
    location: business.location || '',
    genre: business.category || '',
  };
  let output = String(text || '');
  for (const [key,value] of Object.entries(replacements)) {
    const forms = [
      new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}', 'gi'),
      new RegExp('\\{' + key + '\\}', 'gi'),
      new RegExp('\\[' + key + '\\]', 'gi'),
    ];
    for (const pattern of forms) output = output.replace(pattern, value);
  }
  return output;
}

function preparedFromFile(business: Business): Prepared {
  const raw = business.raw || {};
  return {
    subject: valueFor(raw, SUBJECT_KEYS),
    message: valueFor(raw, MESSAGE_KEYS),
    source: valueFor(raw, MESSAGE_KEYS) ? 'Uploaded prepared message' : '',
  };
}

export default function ManualOutreachClient({ workspace, initialProspectId = '' }: { workspace: Workspace; initialProspectId?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [prospects,setProspects] = useState<Business[]>([]);
  const [senders,setSenders] = useState<GmailAccount[]>([]);
  const [templates,setTemplates] = useState<MessageTemplate[]>([]);
  const [selected,setSelected] = useState<Business | null>(null);
  const [senderId,setSenderId] = useState('');
  const [templateId,setTemplateId] = useState('');
  const [subject,setSubject] = useState('');
  const [message,setMessage] = useState('');
  const [search,setSearch] = useState('');
  const [type,setType] = useState('author');
  const [status,setStatus] = useState('Choose a prospect. Scout will load the prepared message from the uploaded file when one exists.');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  async function load() {
    const [prospectResult,senderResult,templateResult] = await Promise.all([
      supabase.from('businesses')
        .select('*')
        .eq('workspace_id', workspace.id)
        .not('email','is',null)
        .in('status',['ready','found','connected','pending'])
        .order('created_at',{ ascending:false })
        .limit(500),
      supabase.from('gmail_accounts')
        .select('*')
        .eq('workspace_id',workspace.id)
        .in('status',['connected','ready'])
        .order('created_at',{ ascending:true }),
      supabase.from('templates')
        .select('*')
        .eq('workspace_id',workspace.id)
        .eq('active',true)
        .eq('template_type','initial')
        .order('created_at',{ ascending:false })
        .limit(100),
    ]);
    if (prospectResult.error) throw prospectResult.error;
    if (senderResult.error) throw senderResult.error;
    if (templateResult.error) throw templateResult.error;
    const senderRows = (senderResult.data || []) as GmailAccount[];
    setProspects((prospectResult.data || []) as Business[]);
    setSenders(senderRows);
    setTemplates((templateResult.data || []) as MessageTemplate[]);
    if (!senderId && senderRows[0]?.id) setSenderId(senderRows[0].id);
  }

  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [workspace.id]);

  const visible = useMemo(() => prospects.filter((row) => {
    const rawType = String((row as any).prospect_type || (row.raw as any)?.prospectType || '').toLowerCase();
    if (type !== 'all' && rawType !== type && !(type === 'author' && String(row.category || '').toLowerCase().includes('author'))) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [row.name,row.email,row.website,row.category,row.location].some((v) => String(v || '').toLowerCase().includes(q));
  }), [prospects,search,type]);

  function chooseProspect(row: Business) {
    setSelected(row);
    setError('');
    const prepared = preparedFromFile(row);
    const template = templates.find((item) => item.id === templateId) || templates[0];
    const nextSubject = prepared.subject || (template ? render(template.subject,row) : '');
    const nextMessage = prepared.message || (template ? render(template.message,row) : '');
    setSubject(nextSubject);
    setMessage(nextMessage);
    setStatus(prepared.message
      ? 'Loaded the exact prepared message from this prospect’s uploaded file.'
      : template
        ? 'No prepared message was found in the file, so Scout populated the active template. Review before sending.'
        : 'No prepared message or active template was found. Enter the message before sending.');
  }

  useEffect(() => {
    if (!initialProspectId || selected?.id === initialProspectId) return;
    const row = prospects.find((item) => item.id === initialProspectId);
    if (!row) return;
    const rawType = String(row.prospect_type || (row.raw as any)?.prospectType || 'business').toLowerCase();
    setType(rawType || 'all');
    chooseProspect(row);
  }, [initialProspectId, prospects, templates, selected?.id]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!selected) return;
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setSubject(render(template.subject,selected));
    setMessage(render(template.message,selected));
    setStatus('Template applied. You can edit the subject and message before sending.');
  }

  async function sendNow() {
    if (!selected?.email || !senderId || !subject.trim() || !message.trim()) {
      setError('Choose a prospect and sender, then confirm the subject and message.');
      return;
    }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/gmail/send', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          workspace_id:workspace.id,
          gmail_account_id:senderId,
          to:selected.email,
          subject:subject.trim(),
          body:message.trim(),
        }),
      });
      const json = await response.json();
      if (!response.ok || json.success === false) throw new Error(json.error || 'Message could not be sent.');

      const sender = senders.find((item) => item.id === senderId);
      const result = Array.isArray(json.results) ? json.results[0] || {} : {};
      const now = new Date().toISOString();
      const prepared = preparedFromFile(selected);

      const historyWrites = await Promise.allSettled([
        supabase.from('businesses').update({
          status: 'contacted',
          updated_at: now,
        }).eq('workspace_id', workspace.id).eq('id', selected.id),
        supabase.from('sent_messages').insert({
          workspace_id: workspace.id,
          business_id: selected.id,
          template_id: templateId || null,
          gmail_account_id: senderId,
          to_email: selected.email,
          from_email: sender?.email || null,
          subject: subject.trim(),
          body: message.trim(),
          provider_message_id: result.gmailMessageId || null,
          gmail_thread_id: result.gmailThreadId || null,
          status: 'sent',
          delivery_status: 'sent',
          sent_at: now,
          is_follow_up: false,
          raw: {
            manual_review_send: true,
            prepared_from_upload: Boolean(prepared.message),
          },
        }),
        supabase.from('outreach_events').insert({
          workspace_id: workspace.id,
          business_id: selected.id,
          gmail_account_id: senderId,
          template_id: templateId || null,
          type: 'manual_sent',
          message: 'Manual review message sent to ' + selected.email,
          raw: {
            subject: subject.trim(),
            prepared_from_upload: Boolean(prepared.message),
          },
        }),
      ]);
      const failedHistory = historyWrites.find((item) => item.status === 'rejected');
      if (failedHistory) {
        setStatus('Message sent, but Scout could not save every history record. Refresh the prospect Activity before relying on its status.');
      } else {
        setStatus('Sent to ' + selected.email + '. The prospect has been marked contacted.');
      }
      setProspects((rows) => rows.filter((row) => row.id !== selected.id));
      setSelected(null); setSubject(''); setMessage('');
    } catch(e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid two">
      <div className="card" style={{padding:18}}>
        <div className="topbar">
          <div><h3 style={{margin:0}}>Prospects</h3><p className="muted">Click Prepare to load that person’s message.</p></div>
          <Link className="btn secondary" href="/upload">Upload author file</Link>
        </div>
        <div className="grid two" style={{marginTop:12}}>
          <label><span>Type</span><select value={type} onChange={(e)=>setType(e.target.value)}>
            <option value="author">Authors</option><option value="all">All prospects</option>
            <option value="shopify">Shopify</option><option value="website_design">Website Design</option>
            <option value="automation">Automation</option><option value="planner">Planner</option>
          </select></label>
          <label><span>Search</span><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Name, email, country…" /></label>
        </div>
        <div className="stack" style={{marginTop:14,maxHeight:650,overflow:'auto'}}>
          {visible.map((row)=> {
            const prepared = preparedFromFile(row);
            return <div key={row.id} className="card" style={{padding:12}}>
              <div className="topbar">
                <div>
                  <strong>{row.name || row.email}</strong>
                  <div className="muted">{row.email} · {row.location || row.category || 'Prospect'}</div>
                  {prepared.message && <span className="badge">Prepared message</span>}
                </div>
                <button className="btn secondary" type="button" onClick={()=>chooseProspect(row)}>Prepare</button>
              </div>
            </div>;
          })}
          {!visible.length && <div className="notice">No matching prospects with email. Upload an author file or run Scout first.</div>}
        </div>
      </div>

      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Manual Review & Send</h3>
        <p className="muted">Scout populates the email. You review or edit it, then click Send Now. Nothing is sent until you click the final button.</p>
        <div className="stack">
          <label><span>To</span><input value={selected?.email || ''} readOnly placeholder="Choose a prospect" /></label>
          <div className="grid two">
            <label><span>Send from</span><select value={senderId} onChange={(e)=>setSenderId(e.target.value)}>
              <option value="">Choose sender</option>
              {senders.map((sender)=><option key={sender.id} value={sender.id}>{sender.email} · {sender.auth_mode === 'smtp' ? 'SMTP' : 'OAuth'}</option>)}
            </select></label>
            <label><span>Template fallback</span><select value={templateId} onChange={(e)=>applyTemplate(e.target.value)}>
              <option value="">Use uploaded message first</option>
              {templates.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}
            </select></label>
          </div>
          <label><span>Subject</span><input value={subject} onChange={(e)=>setSubject(e.target.value)} placeholder="Subject" /></label>
          <label><span>Message</span><textarea rows={16} value={message} onChange={(e)=>setMessage(e.target.value)} placeholder="Prepared message appears here" /></label>
          {error && <div className="error">{error}</div>}
          <div className="notice">{status}</div>
          <div className="actions">
            <button className="btn" type="button" disabled={busy || !selected} onClick={sendNow}>{busy ? 'Sending…' : 'Send Now'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
