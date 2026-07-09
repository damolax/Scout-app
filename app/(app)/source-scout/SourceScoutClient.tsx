'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Search, UploadCloud, Wand2 } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { buildSourceScoutDorks, searchUrl, type SourceScoutMode } from '@/lib/source-scout';

type ImportResponse = {
  success?: boolean;
  error?: string;
  parsed?: number;
  inserted?: number;
  skippedOrDuplicate?: number;
  directEmails?: number;
  websiteOnly?: number;
  queuedAutoScout?: number;
  sample?: Array<Record<string, unknown>>;
  rejected?: Array<{ value: string; reason: string }>;
};

function fmt(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}

function sampleValue(row: Record<string, unknown>, key: string) {
  return String(row[key] || '').slice(0, 140);
}

export default function SourceScoutClient({ workspace }: { workspace: Workspace }) {
  const [sourceMode, setSourceMode] = useState<SourceScoutMode>('google_dork');
  const [niche, setNiche] = useState('Shopify stores');
  const [location, setLocation] = useState('Germany');
  const [country, setCountry] = useState('');
  const [text, setText] = useState('');
  const [directEmailsReady, setDirectEmailsReady] = useState(true);
  const [enqueueWebsiteAutoScout, setEnqueueWebsiteAutoScout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [message, setMessage] = useState('Ready. Generate dorks, open Google/Bing, paste result text or directory pages, then import.');

  const dorks = useMemo(() => buildSourceScoutDorks({ niche, location, country, sourceMode }), [niche, location, country, sourceMode]);
  const extensionEndpoint = typeof window === 'undefined' ? '' : `${window.location.origin}/api/extension/ingest`;

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  }

  async function submit(previewOnly = false) {
    setBusy(true);
    setResult(null);
    setMessage(previewOnly ? 'Analyzing pasted source...' : 'Importing source leads and queuing website-only leads for Auto Scout...');
    try {
      const res = await fetch('/api/source-scout/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, sourceMode, niche, location, country, text, directEmailsReady, enqueueWebsiteAutoScout, previewOnly })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Source Scout request failed.');
      setResult(json);
      setMessage(previewOnly
        ? `Preview found ${fmt(json.leads?.length || json.parsed)} lead(s).`
        : `Imported ${fmt(json.inserted)} lead(s). Direct emails: ${fmt(json.directEmails)}. Website-only queued for Auto Scout: ${fmt(json.queuedAutoScout)}.`);
    } catch (error) {
      setMessage(`Source Scout failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="notice">
        <b>How this works:</b> dorking/directories are for finding direct emails and websites. If a direct email is found, it can go Ready. If only a website is found, Source Scout sends it to Auto Scout for proper website/contact-page searching.
      </div>

      <div className="grid grid-3">
        <div className="card kpi"><div className="title">Direct email finder</div><div className="num">Email</div><p className="muted">Finds emails directly from pasted Google/Bing snippets, directory pages, or extension text.</p></div>
        <div className="card kpi"><div className="title">Website finder</div><div className="num">Site</div><p className="muted">Finds official websites from directories/search results when no email is visible yet.</p></div>
        <div className="card kpi"><div className="title">Auto Scout handoff</div><div className="num">Deep</div><p className="muted">Queues website-only businesses so Auto Scout checks contact/about/impressum pages for real emails.</p></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="grid grid-4">
          <div>
            <label className="label">Source type</label>
            <select className="select" value={sourceMode} onChange={(e) => setSourceMode(e.target.value as SourceScoutMode)}>
              <option value="google_dork">Google dorking</option>
              <option value="bing_dork">Bing dorking</option>
              <option value="directory">Directory website</option>
              <option value="extension">Extension import</option>
              <option value="mixed">Mixed pasted source</option>
            </select>
          </div>
          <div>
            <label className="label">Niche / business type</label>
            <input className="input" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="dentists, Shopify stores, restaurants" />
          </div>
          <div>
            <label className="label">City / area</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="London, Texas, Berlin" />
          </div>
          <div>
            <label className="label">Country / extra filter</label>
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="optional" />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Google/Bing dorks</h3>
            <p className="muted" style={{ margin: '5px 0 0' }}>Open the searches, copy useful results/directory pages, then paste below.</p>
          </div>
          <button className="btn secondary" onClick={() => copy(dorks.join('\n'), 'Dorks')}><Copy size={16} /> Copy all</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Dork query</th><th>Open</th><th>Copy</th></tr></thead>
            <tbody>
              {dorks.map((dork) => (
                <tr key={dork}>
                  <td><code>{dork}</code></td>
                  <td className="actions">
                    <a className="btn secondary" href={searchUrl('google', dork)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Google</a>
                    <a className="btn secondary" href={searchUrl('bing', dork)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Bing</a>
                  </td>
                  <td><button className="btn secondary" onClick={() => copy(dork, 'Dork')}><Copy size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="grid grid-2">
          <div>
            <label className="label">Paste Google/Bing result text, directory page text/HTML, website list, or email list</label>
            <textarea className="textarea" style={{ minHeight: 240 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Example:\nABC Dental | https://abcdental.com | info@abcdental.com\nExample Shop Germany - www.exampleshop.de\ninfo@example.com'} />
          </div>
          <div className="stack">
            <div className="notice">
              <b>Important:</b> Source Scout does not blindly generate emails. It imports emails that are visible in your pasted source. Websites without email are sent to Auto Scout.
            </div>
            <label className="checkbox-row"><input type="checkbox" checked={directEmailsReady} onChange={(e) => setDirectEmailsReady(e.target.checked)} /> Direct emails found in source should go to Ready.</label>
            <label className="checkbox-row"><input type="checkbox" checked={enqueueWebsiteAutoScout} onChange={(e) => setEnqueueWebsiteAutoScout(e.target.checked)} /> Website-only leads should be queued for Auto Scout.</label>
            <div className="actions">
              <button className="btn secondary" disabled={busy || !text.trim()} onClick={() => submit(true)}><Search size={16} /> Preview only</button>
              <button className="btn" disabled={busy || !text.trim()} onClick={() => submit(false)}><UploadCloud size={16} /> Import + queue</button>
              <Link className="btn secondary" href="/auto-scout"><Wand2 size={16} /> Go to Auto Scout</Link>
            </div>
            <div className={message.includes('failed') ? 'error' : 'success'}>{message}</div>
          </div>
        </div>
      </div>

      {result && (
        <div className="grid grid-4">
          <div className="card kpi"><div className="title">Parsed</div><div className="num">{fmt(result.parsed || result.sample?.length)}</div></div>
          <div className="card kpi"><div className="title">Inserted</div><div className="num">{fmt(result.inserted)}</div></div>
          <div className="card kpi"><div className="title">Direct emails</div><div className="num">{fmt(result.directEmails)}</div></div>
          <div className="card kpi"><div className="title">Queued Auto Scout</div><div className="num">{fmt(result.queuedAutoScout)}</div></div>
        </div>
      )}

      {result?.sample?.length ? (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Sample leads</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Website</th><th>Status logic</th></tr></thead>
              <tbody>
                {result.sample.slice(0, 50).map((row, idx) => (
                  <tr key={idx}>
                    <td>{sampleValue(row, 'name')}</td>
                    <td>{sampleValue(row, 'email') || <span className="muted">No direct email</span>}</td>
                    <td>{sampleValue(row, 'website') || <span className="muted">No website</span>}</td>
                    <td>{sampleValue(row, 'reason')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Extension bridge</h3>
        <p className="muted">The extension still posts captured businesses into Scout through this endpoint. Use your workspace API key from Settings/Data Safety inside the extension.</p>
        <div className="grid grid-2">
          <div>
            <label className="label">Extension ingest endpoint</label>
            <div className="actions"><input className="input" value={extensionEndpoint} readOnly /><button className="btn secondary" onClick={() => copy(extensionEndpoint, 'Endpoint')}>Copy</button></div>
          </div>
          <div>
            <label className="label">Workspace key</label>
            <div className="actions"><input className="input" value={workspace.api_key || 'Open Data Safety or Settings to reveal/copy the workspace key'} readOnly /><button className="btn secondary" disabled={!workspace.api_key} onClick={() => copy(workspace.api_key || '', 'Workspace key')}>Copy</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
