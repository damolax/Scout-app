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

const AUTHOR_PRESETS = [
  {
    id: 'auto-daily',
    name: 'Smart daily author discovery',
    description: 'A broad author-search preset whose underlying source/query order changes each day and again after every run.',
    positions: 'emerging author, mid-list author, independent author',
    genres: 'Literary Fiction, Historical Fiction, Contemporary Fiction, Mystery, Romance, Fantasy, Science Fiction, Memoir',
    instructions: 'Find active under-the-radar authors with current publishing or writing activity, official web presence and public professional contact details. Avoid celebrity-level authors.',
  },
  {
    id: 'emerging-fiction',
    name: 'Emerging fiction authors',
    description: 'Under-the-radar fiction authors with current activity, an official website and a public professional email.',
    positions: 'emerging author, mid-list author',
    genres: 'Literary Fiction, Historical Fiction, Contemporary Fiction, Mystery, Romance, Fantasy, Science Fiction',
    instructions: 'Prefer non-celebrity authors with recent books, events, newsletters, works in progress, publisher notes or other current activity.',
  },
  {
    id: 'recent-release',
    name: 'Authors with recent releases',
    description: 'Authors with a recent book, launch, event or active work signal.',
    positions: 'emerging author, mid-list author',
    genres: '',
    instructions: 'Prioritize authors with a recent release, book launch, event, newsletter, interview, work in progress or publisher update. Avoid celebrities.',
  },
  {
    id: 'self-published-active',
    name: 'Active self-published authors',
    description: 'Independent authors who are actively publishing and have their own web presence.',
    positions: 'independent author, self-published author',
    genres: '',
    instructions: 'Prefer active independent/self-published authors with an official website and public professional email. Avoid authors with no current activity.',
  },
  {
    id: 'association-members',
    name: 'Writers association & festival authors',
    description: 'Find authors through associations, literature centres, festivals, fairs and author directories.',
    positions: 'emerging author, mid-list author',
    genres: '',
    instructions: 'Use writers associations, literature centres, festivals, book fairs and reputable author directories as discovery routes, then verify the author independently.',
  },
  {
    id: 'custom',
    name: 'Custom author search',
    description: 'Choose the country, genre, stage and instructions yourself.',
    positions: 'emerging author, mid-list author',
    genres: '',
    instructions: '',
  },
] as const;

const DURATIONS = [
  [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [360, '6 hours'],
  [720, '12 hours'], [1440, '1 day'], [4320, '3 days'], [10080, '7 days'],
] as const;

function csv(value: string) {
  return value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function elapsedLabel(run: any) {
  const started = new Date(String(run?.started_at || run?.created_at || '')).getTime();
  if (!Number.isFinite(started)) return 'Queued';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  if (seconds >= 3600) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  return Math.floor(seconds / 60) + 'm';
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
  const [instructions, setInstructions] = useState('Find active under-the-radar authors with current publishing or writing activity, official web presence and public professional contact details. Avoid celebrity-level authors.');
  const [duration, setDuration] = useState(30);
  const [authorPreset, setAuthorPreset] = useState('auto-daily');
  const [genres, setGenres] = useState('Literary Fiction, Historical Fiction, Contemporary Fiction, Mystery, Romance, Fantasy, Science Fiction, Memoir');
  const [positions, setPositions] = useState('emerging author, mid-list author, independent author');
  const [languages, setLanguages] = useState('');
  const [genders, setGenders] = useState('any');
  const [requireWebsite, setRequireWebsite] = useState(true);
  const [requireEmail, setRequireEmail] = useState(true);
  const [background, setBackground] = useState(true);
  const [maxPages, setMaxPages] = useState(7);
  const [maxQueries, setMaxQueries] = useState(3);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [authorJobs, setAuthorJobs] = useState<any[]>([]);
  const [activeAuthorJob, setActiveAuthorJob] = useState<any>(null);
  const [authorPlanSamples, setAuthorPlanSamples] = useState<string[]>([]);
  const [authorRotationSeed, setAuthorRotationSeed] = useState('');
  const [genericRuns, setGenericRuns] = useState<any[]>([]);
  const [quickResult, setQuickResult] = useState<any>(null);

  const selectedType = useMemo(() => SCOUT_TYPES.find((item) => item.id === type) || SCOUT_TYPES[0], [type]);
  const activeGenericRun = useMemo(
    () => genericRuns.find((run) => run.scout_type === type && ['queued','running','paused'].includes(String(run.status))),
    [genericRuns, type],
  );

  function applyAuthorPreset(id: string) {
    setAuthorPreset(id);
    const preset = AUTHOR_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setPositions(preset.positions);
    setGenres(preset.genres);
    setInstructions(preset.instructions);
  }

  function chooseType(next: ScoutType) {
    setType(next);
    const config = SCOUT_TYPES.find((item) => item.id === next);
    if (config && next !== 'custom') setNiche(config.niche);
    if (next === 'author') setNiche('authors');
    setQuickResult(null);
    setNotice('');
    setError('');
  }

  const loadAuthorJobs = useCallback(async () => {
    if (type !== 'author') return;
    try {
      const response = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId), { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || json.detail || 'Could not load Author Scout jobs.');
      setAuthorJobs(json.jobs || []);
      const active = (json.jobs || []).find((job: any) => ['queued','starting','running'].includes(String(job.status)));
      const jobId = active?.id || activeAuthorJob?.job?.id;
      if (jobId) {
        const detailResponse = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId) + '&job_id=' + encodeURIComponent(jobId), { cache: 'no-store' });
        const detail = await detailResponse.json();
        if (detailResponse.ok) setActiveAuthorJob(detail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [type, workspaceId, activeAuthorJob?.job?.id]);

  const loadGenericRuns = useCallback(async () => {
    if (type === 'author') return;
    try {
      const response = await fetch('/api/scout/runs?workspace_id=' + encodeURIComponent(workspaceId), { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load background Scout runs.');
      setGenericRuns(json.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [type, workspaceId]);

  useEffect(() => {
    if (type !== 'author') return;
    loadAuthorJobs();
    const timer = window.setInterval(loadAuthorJobs, 6000);
    return () => window.clearInterval(timer);
  }, [type, loadAuthorJobs]);

  useEffect(() => {
    if (type === 'author') return;
    loadGenericRuns();
    const timer = window.setInterval(loadGenericRuns, 8000);
    return () => window.clearInterval(timer);
  }, [type, loadGenericRuns]);

  function discoverySignals() {
    return [
      type === 'shopify' ? 'shopify store owner founder contact email' : '',
      type === 'website_design' ? 'contact owner website book a call get a quote' : '',
      type === 'automation' ? 'booking appointment quote enquiry contact' : '',
      type === 'planner' ? 'digital planner shop creator contact email' : '',
      instructions,
    ].filter(Boolean);
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setQuickResult(null);

    try {
      if (type === 'author') {
        const response = await fetch('/api/scout/authors', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            action: 'start',
            preset_id: authorPreset,
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
        setAuthorPlanSamples(Array.isArray(json.search_plan_samples) ? json.search_plan_samples : []);
        setAuthorRotationSeed(String(json.rotation_seed || ''));
        await loadAuthorJobs();
        const detail = await fetch('/api/scout/authors?workspace_id=' + encodeURIComponent(workspaceId) + '&job_id=' + encodeURIComponent(json.job_id));
        const detailJson = await detail.json();
        if (detail.ok) setActiveAuthorJob(detailJson);
        return;
      }

      if (background) {
        const response = await fetch('/api/scout/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            action: 'start',
            scout_type: type,
            niche: niche || selectedType.niche,
            location,
            country,
            category: selectedType.title,
            signals: discoverySignals(),
            max_pages: maxPages,
            max_search_queries: maxQueries,
            duration_minutes: duration,
          }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not start background Scout.');
        setNotice(json.warning || 'Background Scout started. You can close this page; the server worker will keep scouting and queue website-only prospects for email enrichment.');
        await loadGenericRuns();
        return;
      }

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
          scoutSignals: discoverySignals().join('\n'),
          audienceCategoryName: selectedType.title,
        }),
      });
      const json = await response.json();
      if (!response.ok || json.success === false) throw new Error(json.error || 'Scout run failed.');
      setQuickResult(json);
      setNotice('Quick Scout finished. Website-only prospects are now in the background email-enrichment queue.');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stopGenericRun() {
    if (!activeGenericRun?.id) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/scout/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action: 'stop', run_id: activeGenericRun.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not stop Scout.');
      setNotice('Scout stopped. Prospects already found remain in Prospects.');
      await loadGenericRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
            <h3 style={{ margin: '8px 0 0' }}>{type === 'author' || background ? 'Background Scout' : 'Quick Scout'}</h3>
          </div>
          <span className="muted">{type === 'author' || background ? 'Runs on a server worker after you close this page.' : 'Runs once while this request is open, then enrichment continues in the background.'}</span>
        </div>

        <form onSubmit={start} className="stack">
          <div className="grid grid-3">
            <label><span>Country / market</span><input value={country} onChange={(e) => setCountry(e.target.value)} placeholder={type === 'author' ? 'UK, Canada, Australia' : 'United States'} /></label>
            {type !== 'author' && <label><span>City / area</span><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" /></label>}
            {type !== 'author' && <label><span>Niche</span><input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="What should Scout find?" required /></label>}
            {type === 'author' && <label><span>Genres</span><input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Historical Fiction, Romance" /></label>}
            {type === 'author' && <label><span>Career stage</span><input value={positions} onChange={(e) => setPositions(e.target.value)} placeholder="emerging author, mid-list author" /></label>}
          </div>

          {type === 'author' && <>
            <div className="card" style={{ padding: 14 }}>
              <div className="grid two">
                <label><span>Author search preset</span><select value={authorPreset} onChange={(e) => applyAuthorPreset(e.target.value)}>
                  {AUTHOR_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select></label>
                <div className="notice">
                  <strong>Auto-rotating query:</strong> {AUTHOR_PRESETS.find((item) => item.id === authorPreset)?.description || 'Custom search'} Scout rotates the underlying route order each day and again after this preset is run, so repeated searches explore different sources instead of restarting from the same query order.
                </div>
              </div>
            </div>
            <div className="grid grid-3">
            <label><span>Languages</span><input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Spanish" /></label>
            <label><span>Gender routes</span><input value={genders} onChange={(e) => setGenders(e.target.value)} placeholder="any, male, female" /></label>
            <label><span>Run for</span><select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div></>}

          {type === 'author' ? <div className="actions">
            <label className="checkbox-row"><input type="checkbox" checked={requireWebsite} onChange={(e) => setRequireWebsite(e.target.checked)} /> Require website signal</label>
            <label className="checkbox-row"><input type="checkbox" checked={requireEmail} onChange={(e) => setRequireEmail(e.target.checked)} /> Require public professional email signal</label>
          </div> : <>
            <div className="actions">
              <label className="checkbox-row"><input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /> Keep scouting in the background</label>
            </div>
            <div className="grid grid-3">
              <label><span>Search queries per cycle</span><input type="number" min={1} max={5} value={maxQueries} onChange={(e) => setMaxQueries(Number(e.target.value))} /></label>
              <label><span>Pages per cycle</span><input type="number" min={4} max={10} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} /></label>
              {background && <label><span>Run for</span><select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>}
            </div>
          </>}

          <label><span>Additional instructions</span><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder={type === 'author' ? 'Avoid celebrity authors. Prefer current work and direct public contacts.' : 'Describe the type of prospect or public signals you care about.'} /></label>

          <div className="actions">
            <button className="btn" disabled={busy}>{busy ? 'Working…' : type === 'author' || background ? 'Start Background Scout' : 'Run Quick Scout'}</button>
            {type === 'author' && activeAuthorJob?.job && ['queued','starting','running'].includes(String(activeAuthorJob.job.status)) &&
              <button className="btn secondary" type="button" disabled={busy} onClick={stopAuthorJob}>Stop Scout</button>}
            {type !== 'author' && activeGenericRun &&
              <button className="btn secondary" type="button" disabled={busy} onClick={stopGenericRun}>Stop Scout</button>}
          </div>
        </form>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {type === 'author' && authorPlanSamples.length > 0 && <div className="card" style={{ padding: 18 }}>
        <div className="topbar">
          <div>
            <h3 style={{ margin: 0 }}>Search routes for this run</h3>
            <p className="muted" style={{ marginBottom: 0 }}>These are samples from the rotated plan. The next run of the same preset receives a new rotation seed.</p>
          </div>
          {authorRotationSeed && <span className="badge">{authorRotationSeed.split(':').slice(-2).join(' · ')}</span>}
        </div>
        <ol>
          {authorPlanSamples.slice(0, 5).map((query) => <li key={query} style={{ marginBottom: 8 }}>{query}</li>)}
        </ol>
      </div>}

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

      {type !== 'author' && activeGenericRun && <div className="card" style={{ padding: 18 }}>
        <div className="topbar">
          <div><span className="badge">{activeGenericRun.status}</span><h3 style={{ margin: '8px 0 0' }}>{selectedType.title} Background Scout</h3></div>
          <strong>{Number(activeGenericRun.qualified_count || 0).toLocaleString()} saved</strong>
        </div>
        <p className="muted">{activeGenericRun.progress_text || 'Waiting for the background worker.'}</p>
        <div className="grid grid-4">
          <div><strong>{Number(activeGenericRun.discovered_count || 0).toLocaleString()}</strong><div className="muted">Discovered</div></div>
          <div><strong>{Number(activeGenericRun.qualified_count || 0).toLocaleString()}</strong><div className="muted">New prospects</div></div>
          <div><strong>{Number(activeGenericRun.email_count || 0).toLocaleString()}</strong><div className="muted">Emails found</div></div>
          <div><strong>{elapsedLabel(activeGenericRun)}</strong><div className="muted">Elapsed</div></div>
        </div>
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
