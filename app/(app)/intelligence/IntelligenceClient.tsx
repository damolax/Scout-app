'use client';

import { FormEvent, useMemo, useState } from 'react';

type Prospect = {
  id: string;
  name?: string | null;
  website?: string | null;
  email?: string | null;
  location?: string | null;
  category?: string | null;
  prospect_type?: string | null;
  opportunity_score?: number | null;
};

type Scan = {
  id: string;
  prospect_name?: string | null;
  website?: string | null;
  industry?: string | null;
  opportunity_score?: number | null;
  readiness_score?: number | null;
  confidence?: number | null;
  status?: string | null;
  created_at?: string | null;
};

function scoreLabel(score: number) {
  if (score >= 80) return 'High opportunity';
  if (score >= 65) return 'Good opportunity';
  if (score >= 50) return 'Review';
  return 'Lower priority';
}

export default function IntelligenceClient({
  workspaceId,
  prospects,
  recentScans,
}: {
  workspaceId: string;
  prospects: Prospect[];
  recentScans: Scan[];
}) {
  const [businessId, setBusinessId] = useState('');
  const [website, setWebsite] = useState('');
  const [prospectName, setProspectName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(() => prospects.find((item) => item.id === businessId) || null, [businessId, prospects]);

  function chooseProspect(id: string) {
    setBusinessId(id);
    const item = prospects.find((prospect) => prospect.id === id);
    if (!item) return;
    setWebsite(item.website || '');
    setProspectName(item.name || '');
    setCountry(item.location || '');
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setAnalysis(null);
    try {
      const response = await fetch('/api/intelligence/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          business_id: businessId || null,
          website,
          prospect_name: prospectName,
          target_country: country,
          target_city: city,
          competitor_urls: competitors,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Analysis failed.');
      setAnalysis(json.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const summary = analysis?.summary || {};
  const opportunities = Array.isArray(analysis?.opportunities) ? analysis.opportunities.slice(0, 8) : [];
  const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths.slice(0, 5) : [];
  const services = Array.isArray(analysis?.serviceRecommendations) ? analysis.serviceRecommendations.slice(0, 6) : [];

  return (
    <>
      <div className="card" style={{ padding: 18 }}>
        <form onSubmit={analyze} className="stack">
          <div className="grid two">
            <label>
              <span>Prospect from Scout</span>
              <select value={businessId} onChange={(e) => chooseProspect(e.target.value)}>
                <option value="">Analyze a website manually</option>
                {prospects.map((item) => <option key={item.id} value={item.id}>{item.name || item.website || item.id}</option>)}
              </select>
            </label>
            <label>
              <span>Website</span>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" required />
            </label>
          </div>
          <div className="grid two">
            <label>
              <span>Prospect / business name</span>
              <input value={prospectName} onChange={(e) => setProspectName(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              <span>Country / market</span>
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <div className="grid two">
            <label>
              <span>City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              <span>Competitor websites</span>
              <input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Up to 3, separated by commas" />
            </label>
          </div>
          <div className="actions">
            <button className="btn" disabled={busy || !website.trim()}>{busy ? 'Analyzing public website…' : 'Run Intelligence'}</button>
            {selected && <span className="muted">Linked to {selected.name || selected.website}</span>}
          </div>
        </form>
      </div>

      {error && <div className="error">{error}</div>}

      {analysis && <>
        <div className="grid four">
          <div className="card" style={{ padding: 16 }}><div className="muted">Opportunity</div><h2 style={{ margin: '6px 0' }}>{summary.opportunityScore || 0}</h2><strong>{scoreLabel(Number(summary.opportunityScore || 0))}</strong></div>
          <div className="card" style={{ padding: 16 }}><div className="muted">Readiness</div><h2 style={{ margin: '6px 0' }}>{summary.customerExperienceReadiness || 0}</h2><span>Customer journey</span></div>
          <div className="card" style={{ padding: 16 }}><div className="muted">Priority</div><h2 style={{ margin: '6px 0' }}>{summary.prospectPriority?.grade || '—'}</h2><span>{summary.prospectPriority?.label || 'Review'}</span></div>
          <div className="card" style={{ padding: 16 }}><div className="muted">Confidence</div><h2 style={{ margin: '6px 0' }}>{summary.confidence || 0}%</h2><span>{analysis.classification?.industry || 'Unknown industry'}</span></div>
        </div>

        <div className="grid two">
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Strongest opportunities</h3>
            <div className="stack">
              {opportunities.map((item: any) => <div key={item.id} className="card" style={{ padding: 14 }}>
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <strong>{item.title}</strong><span className="badge">{item.score}</span>
                </div>
                <p style={{ marginBottom: 6 }}>{item.ownerWording || item.recommendation}</p>
                <div className="muted">{item.observed}</div>
                {item.sellableService && <div style={{ marginTop: 8 }}><strong>Service:</strong> {item.sellableService}</div>}
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Evidence source ↗</a>}
              </div>)}
            </div>
          </div>

          <div className="stack">
            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ marginTop: 0 }}>What is already working</h3>
              {strengths.map((item: any) => <div key={item.id || item.title} style={{ marginBottom: 12 }}>
                <strong>{item.title}</strong>
                <div className="muted">{item.evidence}</div>
              </div>)}
            </div>
            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ marginTop: 0 }}>Recommended services</h3>
              {services.length ? services.map((item: any, index: number) => <div key={item.id || item.title || index} style={{ marginBottom: 10 }}>
                <strong>{item.title || item.service || String(item)}</strong>
                {item.reason && <div className="muted">{item.reason}</div>}
              </div>) : <p className="muted">Service recommendations are included in the opportunity cards above.</p>}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Outreach angle</h3>
          <p><strong>Subject:</strong> {analysis.outreach?.subject}</p>
          <div style={{ whiteSpace: 'pre-wrap' }}>{analysis.outreach?.message}</div>
          <div className="notice" style={{ marginTop: 14 }}>Scout generated this from public website evidence. Review it before using it, especially where a capability was only “not detected publicly.”</div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0 }}>Analysis limitations</h3>
          <ul>{(analysis.limitations || []).map((item: string) => <li key={item}>{item}</li>)}</ul>
        </div>
      </>}

      {!analysis && recentScans.length > 0 && <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Recent intelligence</h3>
        <div className="stack">
          {recentScans.map((scan) => <div key={scan.id} className="actions" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div><strong>{scan.prospect_name || scan.website}</strong><div className="muted">{scan.industry || 'Website'} · {scan.status || 'complete'}</div></div>
            <div style={{ textAlign: 'right' }}><strong>{scan.opportunity_score || 0}</strong><div className="muted">{scan.confidence || 0}% confidence</div></div>
          </div>)}
        </div>
      </div>}
    </>
  );
}
