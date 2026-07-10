'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, RefreshCw, Send, UploadCloud, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import type { MessageCategory, Workspace } from '@/lib/types';
import type { SourceScoutMode } from '@/lib/source-scout';

type SubmissionRow = {
  id: string;
  scout_date: string;
  submitter_email?: string | null;
  scout_name?: string | null;
  niche?: string | null;
  location?: string | null;
  country?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  source_mode?: string | null;
  notes?: string | null;
  parsed_count: number;
  inserted_count: number;
  skipped_count: number;
  direct_email_count: number;
  website_only_count: number;
  queued_auto_scout_count: number;
  import_batch_id?: string | null;
  status?: string | null;
  created_at: string;
};

type SubmitResponse = {
  success?: boolean;
  error?: string;
  counted?: number;
  inserted?: number;
  directEmails?: number;
  websiteOnly?: number;
  queuedAutoScout?: number;
  skippedOrDuplicate?: number;
};

function localDateIso(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function fmt(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function formatTime(value: string) {
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function totals(rows: SubmissionRow[]) {
  return rows.reduce((acc, row) => {
    acc.submissions += 1;
    acc.parsed += Number(row.parsed_count || 0);
    acc.inserted += Number(row.inserted_count || 0);
    acc.direct += Number(row.direct_email_count || 0);
    acc.website += Number(row.website_only_count || 0);
    acc.queued += Number(row.queued_auto_scout_count || 0);
    return acc;
  }, { submissions: 0, parsed: 0, inserted: 0, direct: 0, website: 0, queued: 0 });
}

function byPerson(rows: SubmissionRow[]) {
  const map = new Map<string, { name: string; email: string; submissions: number; parsed: number; inserted: number; direct: number; website: number; queued: number; last: string }>();
  for (const row of rows) {
    const email = row.submitter_email || 'unknown';
    const key = `${email}|${row.scout_name || ''}`;
    const current = map.get(key) || { name: row.scout_name || email, email, submissions: 0, parsed: 0, inserted: 0, direct: 0, website: 0, queued: 0, last: row.created_at };
    current.submissions += 1;
    current.parsed += Number(row.parsed_count || 0);
    current.inserted += Number(row.inserted_count || 0);
    current.direct += Number(row.direct_email_count || 0);
    current.website += Number(row.website_only_count || 0);
    current.queued += Number(row.queued_auto_scout_count || 0);
    if (new Date(row.created_at).getTime() > new Date(current.last).getTime()) current.last = row.created_at;
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.parsed - a.parsed || b.inserted - a.inserted);
}

export default function DailyScoutingClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [audienceCategoryId, setAudienceCategoryId] = useState(workspace.default_audience_category_id || '');
  const [newAudienceCategory, setNewAudienceCategory] = useState(workspace.default_audience_category_name || '');
  const [scoutDate, setScoutDate] = useState(localDateIso());
  const [scoutName, setScoutName] = useState('');
  const [niche, setNiche] = useState('Shopify stores');
  const [location, setLocation] = useState('Germany');
  const [country, setCountry] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceScoutMode>('mixed');
  const [rawText, setRawText] = useState('');
  const [notes, setNotes] = useState('');
  const [manualScoutedCount, setManualScoutedCount] = useState('');
  const [manualDirectEmailCount, setManualDirectEmailCount] = useState('');
  const [manualWebsiteOnlyCount, setManualWebsiteOnlyCount] = useState('');
  const [importToQueue, setImportToQueue] = useState(true);
  const [directEmailsReady, setDirectEmailsReady] = useState(true);
  const [enqueueWebsiteAutoScout, setEnqueueWebsiteAutoScout] = useState(true);
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Submit today\'s scouting history so the owner can see how much every person scouted.');
  const [error, setError] = useState('');
  const summary = totals(rows);
  const people = byPerson(rows);

  const selectedAudienceCategory = categories.find((c) => c.id === audienceCategoryId) || null;

  async function loadCategories() {
    const { data, error } = await supabase
      .from('message_categories')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    setCategories((data || []) as MessageCategory[]);
  }

  async function ensureAudienceCategory() {
    if (audienceCategoryId) return { id: audienceCategoryId, name: selectedAudienceCategory?.name || newAudienceCategory.trim() || '' };
    const name = newAudienceCategory.trim();
    if (!name) return { id: '', name: '' };
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('message_categories')
      .upsert({ workspace_id: workspace.id, name, description: 'Audience category created from Daily Scouting.', active: true, created_by: user?.id || null }, { onConflict: 'workspace_id,name' })
      .select('*')
      .single();
    if (error) throw error;
    setAudienceCategoryId(data.id);
    setNewAudienceCategory(data.name || name);
    await loadCategories();
    return { id: data.id as string, name: String(data.name || name) };
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('daily_scouting_submissions')
        .select('*')
        .eq('workspace_id', workspace.id)
        .eq('scout_date', scoutDate)
        .order('created_at', { ascending: false })
        .limit(500);
      if (loadError) throw loadError;
      setRows((data || []) as SubmissionRow[]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadCategories().catch((err) => setError(formatError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, scoutDate]);

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('Submitting scouting history...');
    try {
      const category = await ensureAudienceCategory();
      const response = await fetch('/api/daily-scouting/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          scoutDate,
          scoutName,
          niche,
          location,
          country,
          sourceMode,
          audienceCategoryId: category.id,
          audienceCategoryName: category.name,
          rawText,
          notes,
          manualScoutedCount,
          manualDirectEmailCount,
          manualWebsiteOnlyCount,
          importToQueue,
          directEmailsReady,
          enqueueWebsiteAutoScout
        })
      });
      const json = (await response.json().catch(() => ({}))) as SubmitResponse;
      if (!response.ok || json.success === false) throw new Error(json.error || `Submit failed with HTTP ${response.status}`);
      setMessage(`Submitted ${fmt(json.counted)} scouted lead(s). Imported ${fmt(json.inserted)} into Businesses. Direct emails ${fmt(json.directEmails)}, website-only ${fmt(json.websiteOnly)}, queued Auto Scout ${fmt(json.queuedAutoScout)}.`);
      setRawText('');
      setManualScoutedCount('');
      setManualDirectEmailCount('');
      setManualWebsiteOnlyCount('');
      setNotes('');
      await load();
    } catch (err) {
      setError(formatError(err));
      setMessage('Submission failed. Check the error and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <div className="eyebrow">Scout v8.36</div>
          <h1>Daily Scouting</h1>
          <p>Team members submit today\'s scouting history here. You can see how much each person scouted, how many direct emails they found, and how many websites were queued for Auto Scout.</p>
        </div>
        <div className="actions">
          <button className="btn secondary" type="button" onClick={load} disabled={loading}><RefreshCw size={16} /> Refresh</button>
          <Link className="btn secondary" href="/source-scout"><UploadCloud size={16} /> Source Scout</Link>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      <div className={message.toLowerCase().includes('failed') ? 'error' : 'success'}>{message}</div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Submissions</div><div className="num">{fmt(summary.submissions)}</div><p>For selected date</p></div>
        <div className="card kpi"><div className="title">Scouted Leads</div><div className="num">{fmt(summary.parsed)}</div><p>Parsed or manually counted</p></div>
        <div className="card kpi"><div className="title">Imported</div><div className="num">{fmt(summary.inserted)}</div><p>Added to Businesses</p></div>
        <div className="card kpi"><div className="title">Auto Scout Queued</div><div className="num">{fmt(summary.queued)}</div><p>Website-only deep checks</p></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Submit today\'s scouting history</h3>
            <p className="muted" style={{ margin: '5px 0 0' }}>Paste result text, URLs, emails, directory output, or enter manual counts if the scout worked from another tool.</p>
          </div>
          <button className="btn" type="button" disabled={busy} onClick={submit}><Send size={16} /> {busy ? 'Submitting...' : 'Submit History'}</button>
        </div>
        <div className="grid grid-4">
          <div><label className="label">Date</label><input className="input" type="date" value={scoutDate} onChange={(e) => setScoutDate(e.target.value)} /></div>
          <div><label className="label">Scout name, optional</label><input className="input" value={scoutName} onChange={(e) => setScoutName(e.target.value)} placeholder="Team member name" /></div>
          <div><label className="label">Source type</label><select className="select" value={sourceMode} onChange={(e) => setSourceMode(e.target.value as SourceScoutMode)}><option value="mixed">Mixed</option><option value="google_dork">Google dorking</option><option value="bing_dork">Bing dorking</option><option value="directory">Directory</option><option value="extension">Extension</option></select></div>
          <div><label className="label">Import into Businesses?</label><select className="select" value={importToQueue ? 'yes' : 'no'} onChange={(e) => setImportToQueue(e.target.value === 'yes')}><option value="yes">Yes, import parsed leads</option><option value="no">No, count only</option></select></div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div><label className="label">Audience category</label><select className="select" value={audienceCategoryId} onChange={(e) => { setAudienceCategoryId(e.target.value); const cat = categories.find((c) => c.id === e.target.value); if (cat) setNewAudienceCategory(cat.name); }}><option value="">New / uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label">New category name</label><input className="input" value={newAudienceCategory} onChange={(e) => { setNewAudienceCategory(e.target.value); if (audienceCategoryId) setAudienceCategoryId(''); }} placeholder="Airtable service, Marketing, Shopify audit" /></div>
        </div>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div><label className="label">Niche</label><input className="input" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Shopify stores, dentists, restaurants" /></div>
          <div><label className="label">Location</label><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Berlin, Texas, Toronto" /></div>
          <div><label className="label">Country / filter</label><input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="optional" /></div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label className="label">Today scouting history text</label>
            <textarea className="textarea" style={{ minHeight: 250 }} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={'Paste today\'s scouting output here. Example:\nABC Store | https://abcstore.com | info@abcstore.com\nExample Shop Germany - www.exampleshop.de\ninfo@example.com'} />
          </div>
          <div className="stack">
            <div className="notice"><b>Simple rule:</b> if the team member has text, paste it. If they only have a number, use the manual count fields below.</div>
            <div className="grid grid-3">
              <div><label className="label">Manual total scouted</label><input className="input" type="number" min={0} value={manualScoutedCount} onChange={(e) => setManualScoutedCount(e.target.value)} /></div>
              <div><label className="label">Manual direct emails</label><input className="input" type="number" min={0} value={manualDirectEmailCount} onChange={(e) => setManualDirectEmailCount(e.target.value)} /></div>
              <div><label className="label">Manual websites only</label><input className="input" type="number" min={0} value={manualWebsiteOnlyCount} onChange={(e) => setManualWebsiteOnlyCount(e.target.value)} /></div>
            </div>
            <label className="checkbox-row"><input type="checkbox" checked={directEmailsReady} onChange={(e) => setDirectEmailsReady(e.target.checked)} /> Direct emails should go Ready when imported.</label>
            <label className="checkbox-row"><input type="checkbox" checked={enqueueWebsiteAutoScout} onChange={(e) => setEnqueueWebsiteAutoScout(e.target.checked)} /> Website-only leads should queue Auto Scout.</label>
            <label className="label">Notes, optional</label>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What market was searched? Any blockers?" />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}><Users size={18} /> Team totals for {scoutDate}</h3>
            <p className="muted" style={{ margin: '5px 0 0' }}>This is the owner view: who submitted, how much they scouted, and what actually entered the system.</p>
          </div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Person</th><th>Submissions</th><th>Scouted</th><th>Imported</th><th>Direct emails</th><th>Websites only</th><th>Queued Auto Scout</th><th>Last submit</th></tr></thead><tbody>
          {people.map((person) => <tr key={`${person.email}-${person.name}`}><td><strong>{person.name}</strong><br /><span className="muted">{person.email}</span></td><td>{fmt(person.submissions)}</td><td>{fmt(person.parsed)}</td><td>{fmt(person.inserted)}</td><td>{fmt(person.direct)}</td><td>{fmt(person.website)}</td><td>{fmt(person.queued)}</td><td>{formatTime(person.last)}</td></tr>)}
          {!people.length ? <tr><td colSpan={8} className="muted">No one has submitted scouting history for this date yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}><CalendarDays size={18} /> Submission history</h3>
        <div className="table-wrap"><table><thead><tr><th>Submitted</th><th>Scout</th><th>Market</th><th>Category</th><th>Source</th><th>Scouted</th><th>Imported</th><th>Direct</th><th>Website-only</th><th>Queued</th><th>Status</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td>{formatTime(row.created_at)}</td><td><strong>{row.scout_name || row.submitter_email || 'Unknown'}</strong><br /><span className="muted">{row.submitter_email}</span></td><td>{[row.niche, row.location, row.country].filter(Boolean).join(' · ') || '-'}</td><td>{row.category_name || '-'}</td><td>{row.source_mode || '-'}</td><td>{fmt(row.parsed_count)}</td><td>{fmt(row.inserted_count)}</td><td>{fmt(row.direct_email_count)}</td><td>{fmt(row.website_only_count)}</td><td>{fmt(row.queued_auto_scout_count)}</td><td><span className="badge">{row.status || 'submitted'}</span></td></tr>)}
          {!rows.length ? <tr><td colSpan={11} className="muted">No submissions yet.</td></tr> : null}
        </tbody></table></div>
      </div>
    </div>
  );
}
