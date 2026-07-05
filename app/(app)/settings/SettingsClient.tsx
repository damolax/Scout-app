'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { Workspace } from '@/lib/types';

export default function SettingsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [backendUrl, setBackendUrl] = useState(process.env.NEXT_PUBLIC_BACKEND_URL || '');
  const [status, setStatus] = useState('Settings are stored in this browser and Supabase project env.');
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState('Message 1');
  const [subject, setSubject] = useState('{name}, quick idea');
  const [message, setMessage] = useState('Hi {name}, I found your business and had a quick idea.');

  useEffect(() => {
    const saved = localStorage.getItem('scout_v8_backend_url');
    if (saved) setBackendUrl(saved);
    supabase.from('templates').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).then(({ data }) => setTemplates(data || []));
  }, [supabase, workspace.id]);

  function saveLocalBackend() {
    localStorage.setItem('scout_v8_backend_url', backendUrl);
    setStatus('Backend URL saved locally on this device. Put it in NEXT_PUBLIC_BACKEND_URL on Vercel for all devices.');
  }

  async function saveTemplate() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('templates').insert({ workspace_id: workspace.id, name: templateName, subject, message, created_by: user.id });
    if (error) setStatus(error.message);
    else {
      setStatus('Template saved to cloud.');
      const { data } = await supabase.from('templates').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false });
      setTemplates(data || []);
    }
  }

  return (
    <div className="stack">
      <div className="card" style={{ padding: 18 }}>
        <h3>Backend</h3>
        <p className="muted">Keep the old backend for Gmail OAuth, send, read replies, bounce/no-inbox, and enrichment.</p>
        <label className="label">Backend URL</label>
        <input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
        <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={saveLocalBackend}>Save locally</button></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Extension API Key</h3>
        <p className="muted">Optional. The extension does not need login. If later you want direct extension push, store this key inside the extension settings on that browser.</p>
        <input className="input" readOnly value={workspace.api_key || 'No API key found. Re-run migration.'} />
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Email Templates</h3>
        <div className="grid grid-2">
          <div><label className="label">Template name</label><input className="input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} /></div>
          <div><label className="label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        </div>
        <label className="label" style={{ marginTop: 12 }}>Message</label>
        <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="actions" style={{ marginTop: 12 }}><button className="btn" onClick={saveTemplate}>Save template</button></div>
      </div>

      <div className="notice">{status}</div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Saved Templates</h3>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Subject</th><th>Created</th></tr></thead><tbody>
          {templates.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.subject}</td><td>{new Date(t.created_at).toLocaleString()}</td></tr>)}
          {!templates.length ? <tr><td colSpan={3} className="muted">No cloud templates yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
