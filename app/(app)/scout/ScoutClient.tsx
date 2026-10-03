'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Bot, Globe2, ShoppingBag, SlidersHorizontal, Sparkles } from 'lucide-react';

type ScoutType = 'author' | 'shopify' | 'website_design' | 'automation' | 'planner' | 'custom';

const SCOUT_TYPES: Array<{ id: ScoutType; title: string; description: string; icon: any; niche: string }> = [
  { id: 'author', title: 'Authors', description: 'Background author scouting with country, genre, activity, website and public-email qualification.', icon: BookOpen, niche: 'authors' },
  { id: 'shopify', title: 'Shopify Stores', description: 'Find Shopify/ecommerce stores, discover public contacts and queue missing-email research.', icon: ShoppingBag, niche: 'Shopify stores' },
  { id: 'website_design', title: 'Website Design', description: 'Find businesses with websites, then use Opportunity Intelligence to identify evidence-backed improvements.', icon: Globe2, niche: 'businesses with websites' },
  { id: 'automation', title: 'Automation Prospects', description: 'Find service businesses with visible enquiry, booking or manual customer-journey signals.', icon: Bot, niche: 'service businesses' },
  { id: 'planner', title: 'Planner Prospects', description: 'Find planner creators, digital-product sellers, educators or a planner audience you define.', icon: Sparkles, niche: 'digital planner creators sellers' },
  { id: 'custom', title: 'Custom Scout', description: 'Define any niche or prospect type without creating another app.', icon: SlidersHorizontal, niche: '' },
];

function csv(value: string) {
  return value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function durationLabel(seconds: number) {
  const s = Math.max(0, Number(seconds || 0));
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 60) + 'm';
}

export default function ScoutClient({ workspaceId }: { workspaceId: string }) {
  const [type, setType] = useState<ScoutType>('author');
  const [country, setCountry] = useState('');
  const [location, setLocation] = useState('');
  const [niche, setNiche] = useState('authors');
  const [instructions, setInstructions] = useState('');
  const [duration, setDuration] = useState(30);
  const [genres, setGenres] = useState('');
  const [positions, setPositions] = useState('emerging author, mid-list author');
  const [languages, setLanguages] = useState('');
  const [genders, setGenders] = useState('any');
  const [requireWebsite, setRequireWebsite] = useState(true);
  const [requireEmail, setRequireEmail] = useState(true);
  const [maxPages, setMaxPages] = useState(35);
  const [maxQueries, setMaxQueries] = useState(5);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [authorJobs, setAuthorJobs] = useState<any[]>([]);
  const [activeAuthorJob, setActiveAuthorJob] = useState<any>(null);
  const [quickResult, setQuickResult] = useState<any>(null);

  const selectedType = useMemo(() => SCOUT_TYPES.find((item) => item.id === type) || SCOUT_TYPES[0], [type]);

  function chooseType(next: ScoutType) {
    setType(next);
    const config = SCOUT_TYPES.find((item) => item.id === next);
    if (config && next !== 'custom') setNiche(config.niche);
    if (next === 'author') setNiche('authors');
    setQuickResult(null); setNotice(''); setError('');
  }

  const loadAuthorJobs = useCallback(async () => {
    if (type !== 'author') return;
    try {
      const response = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId), { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || json.detail || 'Could not load Author Scout jobs.');
      setAuthorJobs(json.jobs || []);
      const active = (json.jobs || []).find((job: any) => ['queued','starting','running'].includes(String(job.status)));
      if (active) {
        const detailResponse = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId) + '&job_id=' + encodeURIComponent(active.id), { cache: 'no-store' });
        const detail = await detailResponse.json();
        if (detailResponse.ok) setActiveAuthorJob(detail);
      } else if (activeAuthorJob?.job?.id) {
        const detailResponse = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId) + '&job_id=' + encodeURIComponent(activeAuthorJob.job.id), { cache: 'no-store' });
        const detail = await detailResponse.json();
        if (detailResponse.ok) setActiveAuthorJob(detail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [type, workspaceId, activeAuthorJob?.job?.id]);

  useEffect(() => {
    if (type !== 'author') return;
    loadAuthorJobs();
    const timer = window.setInterval(loadAuthorJobs, 6000);
    return () => window.clearInterval(timer);
  }, [type, loadAuthorJobs]);

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice(''); setQuickResult(null);
    try {
      if (type === 'author') {
        const response = await fetch('/api/scout/authors', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            action: 'start',
            countries: csv(country),
            genres: csv(genres),
            positions: csv(positions),
            languages: csv(languages),
            genders: csv(genders),
            activity_signals: ['active 2026'],
            source_types: ['general','writers associations','publishers','festivals','directories'],
            require_website: requireWebsite,
            require_public_email: requireEmail,
            duration_minutes: duration,
            instructions,
            saturation: 'low saturation emerging mid-list non-celebrity',
            year: '2026',
          }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || json.detail || 'Could not start Author Scout.');
        setNotice('Background Author Scout started. You can close Scout; the Author Scout worker will keep running.');
        await loadAuthorJobs();
        const detail = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId) + '&job_id=' + encodeURIComponent(json.job_id));
        const detailJson = await detail.json();
        if (detail.ok) setActiveAuthorJob(detailJson);
      } else {
        const response = await fetch('/api/source-scout/auto-run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            prospectType: type,
            sourceMode: 'bing_dork',
            niche: niche || selectedType.niche,
            location,
            country,
            maxPages,
            maxSearchQueries: maxQueries,
            directEmailsReady: true,
            enqueueWebsiteAutoScout: true,
            scoutSignals: [
              type === 'shopify' ? 'shopify store owner founder contact email' : '',
              type === 'website_design' ? 'contact owner website book a call get a quote' : '',
              type === 'automation' ? 'booking appointment quote enquiry contact' : '',
              type === 'planner' ? 'digital planner shop creator contact email' : '',
              instructions,
            ].filter(Boolean).join('\n'),
            audienceCategoryName: selectedType.title,
          }),
        });
        const json = await response.json();
        if (!response.ok || json.success === false) throw new Error(json.error || 'Scout run failed.');
        setQuickResult(json);
        setNotice('Scout found and imported prospects. Website-only prospects are now in the background email-enrichment queue.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stopAuthorJob() {
    const id = activeAuthorJob?.job?.id || authorJobs.find((job) => ['queued','starting','running'].includes(String(job.status)))?.id;
    if (!id) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/scout/authors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action: 'stop', job_id: id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || json.detail || 'Could not stop Author Scout.');
      setNotice('Stop requested. Authors already found remain in Prospects.');
      await loadAuthorJobs();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="grid grid-3">
        {SCOUT_TYPES.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" className={'card ' + (type === item.id ? 'active' : '')} style={{ padding: 18, textAlign: 'left', cursor: 'pointer' }} onClick={() => chooseType(item.id)}>
            <Icon size={22} />
            <h3 style={{ margin: '10px 0 6px' }}>{item.title}</h3>
            <p className="muted" style={{ margin: 0 }}>{item.description}</p>
          </button>;
        })}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar" style={{ marginBottom: 16 }}>
          <div>
            <span className="badge">{selectedType.title}</span>
            <h3 style={{ margin: '8px 0 0' }}>{type === 'author' ? 'Background Scout' : 'Quick Scout + background enrichment'}</h3>
          </div>
          {type === 'author' && <span className="muted">Runs on the Author Scout worker even after you close this page.</span>}
        </div>

        <form onSubmit={start} className="stack">
          <div className="grid grid-3">
            <label><span>Country / market</span><input value={country} onChange={(e) => setCountry(e.target.value)} placeholder={type === 'author' ? 'UK, Canada, Australia' : 'United States'} /></label>
            {type !== 'author' && <label><span>City / area</span><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" /></label>}
            {type !== 'author' && <label><span>Niche</span><input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="What should Scout find?" required /></label>}
            {type === 'author' && <label><span>Genres</span><input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Historical Fiction, Romance" /></label>}
            {type === 'author' && <label><span>Career stage</span><input value={positions} onChange={(e) => setPositions(e.target.value)} placeholder="emerging author, mid-list author" /></label>}
          </div>

          {type === 'author' && <div className="grid grid-3">
            <label><span>Languages</span><input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Spanish" /></label>
            <label><span>Gender routes</span><input value={genders} onChange={(e) => setGenders(e.target.value)} placeholder="any, male, female" /></label>
            <label><span>Run for</span><select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={10}>10 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
              <option value={360}>6 hours</option><option value={720}>12 hours</option><option value={1440}>1 day</option>
              <option value={4320}>3 days</option><option value={10080}>7 days</option>
            </select></label>
          </div>}

          {type === 'author' ? <div className="actions">
            <label className="checkbox-row"><input type="checkbox" checked={requireWebsite} onChange={(e) => setRequireWebsite(e.target.checked)} /> Require website signal</label>
            <label className="checkbox-row"><input type="checkbox" checked={requireEmail} onChange={(e) => setRequireEmail(e.target.checked)} /> Require public professional email signal</label>
          </div> : <div className="grid two">
            <label><span>Search queries</span><input type="number" min={1} max={8} value={maxQueries} onChange={(e) => setMaxQueries(Number(e.target.value))} /></label>
            <label><span>Pages to inspect</span><input type="number" min={5} max={60} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} /></label>
          </div>}

          <label><span>Additional instructions</span><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder={type === 'author' ? 'Avoid celebrity authors. Prefer current work and direct public contacts.' : 'Describe the type of prospect or public signals you care about.'} /></label>

          <div className="actions">
            <button className="btn" disabled={busy}>{busy ? 'Working…' : type === 'author' ? 'Start Background Scout' : 'Run Scout'}</button>
            {type === 'author' && activeAuthorJob?.job && ['queued','starting','running'].includes(String(activeAuthorJob.job.status)) &&
              <button className="btn secondary" type="button" disabled={busy} onClick={stopAuthorJob}>Stop Scout</button>}
          </div>
        </form>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {type === 'author' && activeAuthorJob?.job && <div className="card" style={{ padding: 18 }}>
        <div className="topbar">
          <div><span className="badge">{activeAuthorJob.job.status}</span><h3 style={{ margin: '8px 0 0' }}>Author Scout #{activeAuthorJob.job.id}</h3></div>
          <strong>{Number(activeAuthorJob.job.accepted || 0).toLocaleString()} saved</strong>
        </div>
        <p className="muted">{activeAuthorJob.job.progress_text || 'Background worker is preparing the search.'}</p>
        <div className="grid grid-4">
          <div><strong>{activeAuthorJob.job.accepted || 0}</strong><div className="muted">Qualified</div></div>
          <div><strong>{activeAuthorJob.job.checked || 0}</strong><div className="muted">Checked</div></div>
          <div><strong>{activeAuthorJob.job.duplicates || 0}</strong><div className="muted">Duplicates</div></div>
          <div><strong>{durationLabel(activeAuthorJob.job.remaining_seconds || 0)}</strong><div className="muted">Remaining</div></div>
        </div>
        {!!activeAuthorJob.results?.length && <div className="table-wrap" style={{ marginTop: 14 }}><table>
          <thead><tr><th>Author</th><th>Country</th><th>Genre</th><th>Email</th><th>Website</th></tr></thead>
          <tbody>{activeAuthorJob.results.slice(0, 30).map((row: any) => <tr key={row.id}>
            <td><strong>{row.name}</strong></td><td>{row.country || '—'}</td><td>{row.genre || '—'}</td>
            <td>{row.email || 'Researching'}</td><td>{row.website ? <a href={row.website} target="_blank" rel="noreferrer">Open ↗</a> : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>}

      {type !== 'author' && quickResult && <div className="grid grid-4">
        <div className="card kpi"><div className="title">Pages checked</div><div className="num">{quickResult.fetchedPages || 0}</div></div>
        <div className="card kpi"><div className="title">Prospects imported</div><div className="num">{quickResult.inserted || 0}</div></div>
        <div className="card kpi"><div className="title">Emails found now</div><div className="num">{quickResult.directEmails || 0}</div></div>
        <div className="card kpi"><div className="title">Queued for email research</div><div className="num">{quickResult.queuedAutoScout || 0}</div></div>
      </div>}
    </>
  );
}
