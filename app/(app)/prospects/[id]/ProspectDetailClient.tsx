'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Business } from '@/lib/types';

type Tab = 'overview' | 'contact' | 'intelligence' | 'outreach' | 'activity';
type AnyRow = Record<string, any>;

const SUBJECT_KEYS = [
  'subject','email subject','email_subject','message subject','message_subject',
  'outreach subject','outreach_subject','subject line','subject_line'
];
const MESSAGE_KEYS = [
  'first message','first_message','message','email message','email_message',
  'outreach message','outreach_message','message to author','message_to_author',
  'first message author language','first_message_author_language','body'
];

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function rawValue(raw: Record<string,unknown> | null | undefined, aliases: string[]) {
  const entries = Object.entries(raw || {}).map(([key,value]) => [normalizeKey(key), String(value ?? '').trim()] as const);
  for (const alias of aliases) {
    const clean = normalizeKey(alias);
    const hit = entries.find(([key,value]) => key === clean && value);
    if (hit) return hit[1];
  }
  return '';
}

function labelType(value: unknown) {
  const key=String(value||'business').toLowerCase();
  const map:Record<string,string>={
    author:'Author',shopify:'Shopify Store',website_design:'Website Design',
    automation:'Automation Prospect',planner:'Planner Prospect',custom:'Custom Prospect',business:'Business'
  };
  return map[key] || key.replace(/_/g,' ').replace(/\b\w/g,(m)=>m.toUpperCase());
}

function display(value: unknown) {
  const text=String(value ?? '').trim();
  return text || '—';
}

function formatDate(value: unknown) {
  if (!value) return '—';
  const date=new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function evidenceLinks(raw: Record<string,unknown> | null | undefined) {
  const urls=new Set<string>();
  const text=JSON.stringify(raw || {});
  for (const match of text.match(/https?:\\?\/\\?\/[^s"'<>]+/gi) || []) {
    const url=match.replace(/\\\//g,'/').replace(/[),.;]+$/g,'');
    if(/^https?:\/\//i.test(url)) urls.add(url);
  }
  return Array.from(urls).slice(0,10);
}

export default function ProspectDetailClient({
  workspaceId,
  prospect,
  scans,
  events,
  sent,
  candidates,
  researchJobs,
}: {
  workspaceId: string;
  prospect: Business;
  scans: AnyRow[];
  events: AnyRow[];
  sent: AnyRow[];
  candidates: AnyRow[];
  researchJobs: AnyRow[];
}) {
  const [tab,setTab]=useState<Tab>('overview');
  const prepared=useMemo(()=>({
    subject:rawValue(prospect.raw,SUBJECT_KEYS),
    message:rawValue(prospect.raw,MESSAGE_KEYS),
  }),[prospect.raw]);
  const latestScan=scans[0] || null;
  const links=useMemo(()=>evidenceLinks(prospect.raw),[prospect.raw]);

  const activity=useMemo(()=>{
    const items=[
      ...events.map((row)=>({id:'e:'+row.id,type:row.type || 'activity',message:row.message || row.type || 'Activity',date:row.created_at,raw:row.raw})),
      ...sent.map((row)=>({id:'s:'+row.id,type:'sent',message:'Message sent to '+(row.to_email || prospect.email || ''),date:row.sent_at,raw:{subject:row.subject,status:row.status}})),
      {id:'created',type:'created',message:'Prospect added to Scout',date:prospect.created_at,raw:{}},
    ];
    return items.sort((a,b)=>new Date(String(b.date||0)).getTime()-new Date(String(a.date||0)).getTime());
  },[events,sent,prospect.created_at,prospect.email]);

  const tabs:Array<[Tab,string]>=[
    ['overview','Overview'],['contact','Contact'],['intelligence','Intelligence'],['outreach','Outreach'],['activity','Activity']
  ];

  return <div className="stack">
    <div className="topbar">
      <div className="page-title">
        <div className="actions" style={{gap:8}}>
          <span className="badge">{labelType(prospect.prospect_type)}</span>
          <span className={'status '+prospect.status}>{prospect.status.replace(/_/g,' ')}</span>
        </div>
        <h2 style={{marginTop:8}}>{prospect.name || prospect.website || prospect.email || 'Prospect'}</h2>
        <p>{prospect.category || ''}{prospect.location ? ' · '+prospect.location : ''}</p>
      </div>
      <div className="actions">
        {prospect.website ? <Link className="btn secondary" href={'/intelligence?business='+encodeURIComponent(prospect.id)}>Analyze Website</Link> : null}
        {prospect.email ? <Link className="btn" href={'/outreach?prospect='+encodeURIComponent(prospect.id)}>Prepare Outreach</Link> : null}
        <Link className="btn secondary" href="/prospects">Back</Link>
      </div>
    </div>

    <div className="grid grid-4">
      <div className="card kpi"><div className="title">Qualification</div><div className="num">{prospect.qualification_score == null ? '—' : prospect.qualification_score}</div><div className="muted">Scout fit score</div></div>
      <div className="card kpi"><div className="title">Opportunity</div><div className="num">{prospect.opportunity_score == null ? '—' : prospect.opportunity_score}</div><div className="muted">Website opportunity</div></div>
      <div className="card kpi"><div className="title">Email</div><div className="num" style={{fontSize:16}}>{prospect.email ? 'Found' : 'Missing'}</div><div className="muted">{prospect.email || 'Needs research'}</div></div>
      <div className="card kpi"><div className="title">Messages</div><div className="num">{sent.length}</div><div className="muted">Recorded sends</div></div>
    </div>

    <div className="card" style={{padding:8}}>
      <div className="actions" style={{gap:6}}>
        {tabs.map(([id,label])=><button key={id} type="button" className={tab===id?'btn':'btn secondary'} onClick={()=>setTab(id)}>{label}</button>)}
      </div>
    </div>

    {tab==='overview' ? <div className="grid two">
      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Prospect overview</h3>
        <table><tbody>
          <tr><th>Type</th><td>{labelType(prospect.prospect_type)}</td></tr>
          <tr><th>Name</th><td>{display(prospect.name)}</td></tr>
          <tr><th>Category / genre</th><td>{display(prospect.category)}</td></tr>
          <tr><th>Country / location</th><td>{display(prospect.location)}</td></tr>
          <tr><th>Source</th><td>{display(prospect.source)}</td></tr>
          <tr><th>Added</th><td>{formatDate(prospect.created_at)}</td></tr>
          <tr><th>Last updated</th><td>{formatDate(prospect.updated_at)}</td></tr>
        </tbody></table>
      </div>
      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Why Scout knows this prospect</h3>
        {links.length ? <div className="stack">{links.map((url)=><a key={url} href={url} target="_blank" rel="noreferrer">{url} ↗</a>)}</div> : <p className="muted">No source URLs were stored with this prospect.</p>}
        {prospect.raw ? <details style={{marginTop:14}}><summary>View stored research data</summary><pre style={{whiteSpace:'pre-wrap',fontSize:12}}>{JSON.stringify(prospect.raw,null,2)}</pre></details> : null}
      </div>
    </div> : null}

    {tab==='contact' ? <div className="grid two">
      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Contact</h3>
        <table><tbody>
          <tr><th>Email</th><td>{display(prospect.email)}</td></tr>
          <tr><th>Phone</th><td>{display(prospect.phone)}</td></tr>
          <tr><th>Website</th><td>{prospect.website ? <a href={prospect.website} target="_blank" rel="noreferrer">{prospect.website} ↗</a> : '—'}</td></tr>
          <tr><th>Role</th><td>{display(prospect.role_title)}</td></tr>
          <tr><th>Person</th><td>{display(prospect.person_name)}</td></tr>
        </tbody></table>
        {!prospect.email && prospect.website ? <div className="notice" style={{marginTop:12}}>This prospect has a website but no email yet. Return to Prospects and click <strong>Find email</strong> to queue enrichment.</div> : null}
      </div>
      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Email research</h3>
        <div className="stack">
          {candidates.map((row)=><div className="card" key={row.id} style={{padding:12}}><strong>{row.email}</strong><div className="muted">{row.status || 'candidate'} · score {row.score ?? '—'} · {row.source || 'Scout'}</div></div>)}
          {!candidates.length ? <p className="muted">No email candidates recorded yet.</p> : null}
        </div>
        {researchJobs[0] ? <div className="notice" style={{marginTop:12}}>Latest research job: <strong>{researchJobs[0].status}</strong>{researchJobs[0].last_error ? ' · '+researchJobs[0].last_error : ''}</div> : null}
      </div>
    </div> : null}

    {tab==='intelligence' ? <div className="card" style={{padding:18}}>
      <div className="actions" style={{justifyContent:'space-between'}}>
        <div><h3 style={{margin:0}}>Opportunity Intelligence</h3><p className="muted">Evidence-backed website opportunity analysis.</p></div>
        {prospect.website ? <Link className="btn" href={'/intelligence?business='+encodeURIComponent(prospect.id)}>{latestScan ? 'Run Again' : 'Run Intelligence'}</Link> : null}
      </div>
      {latestScan ? <div className="grid grid-4" style={{marginTop:14}}>
        <div className="card kpi"><div className="title">Opportunity</div><div className="num">{latestScan.opportunity_score ?? 0}</div></div>
        <div className="card kpi"><div className="title">Readiness</div><div className="num">{latestScan.readiness_score ?? 0}</div></div>
        <div className="card kpi"><div className="title">Priority</div><div className="num">{latestScan.prospect_priority ?? 0}</div></div>
        <div className="card kpi"><div className="title">Confidence</div><div className="num">{latestScan.confidence ?? 0}%</div></div>
      </div> : <div className="notice" style={{marginTop:14}}>{prospect.website ? 'This website has not been analyzed yet.' : 'Add a website before running Opportunity Intelligence.'}</div>}
      {latestScan?.analysis?.opportunities?.length ? <div className="stack" style={{marginTop:16}}>
        {latestScan.analysis.opportunities.slice(0,6).map((item:AnyRow)=><div key={item.id || item.title} className="card" style={{padding:13}}><strong>{item.title}</strong><div className="muted">{item.observed || item.recommendation}</div>{item.sellableService ? <div style={{marginTop:6}}><strong>Service:</strong> {item.sellableService}</div> : null}</div>)}
      </div> : null}
    </div> : null}

    {tab==='outreach' ? <div className="grid two">
      <div className="card" style={{padding:18}}>
        <div className="actions" style={{justifyContent:'space-between'}}><h3 style={{margin:0}}>Prepared outreach</h3>{prospect.email ? <Link className="btn" href={'/outreach?prospect='+encodeURIComponent(prospect.id)}>Open Outreach</Link> : null}</div>
        {prepared.message ? <>
          <p><strong>Subject:</strong> {prepared.subject || <span className="muted">No subject in file</span>}</p>
          <div style={{whiteSpace:'pre-wrap'}}>{prepared.message}</div>
          <div className="notice" style={{marginTop:12}}>This is the message stored with this prospect, usually from an uploaded author file.</div>
        </> : <div className="notice" style={{marginTop:12}}>No per-prospect prepared message is stored. Outreach can use an active template instead.</div>}
      </div>
      <div className="card" style={{padding:18}}>
        <h3 style={{marginTop:0}}>Message history</h3>
        <div className="stack">
          {sent.map((row)=><div className="card" key={row.id} style={{padding:12}}><strong>{row.subject || '(No subject)'}</strong><div className="muted">{formatDate(row.sent_at)} · {row.from_email || 'sender'} → {row.to_email || prospect.email} · {row.status}</div></div>)}
          {!sent.length ? <p className="muted">No messages recorded yet.</p> : null}
        </div>
      </div>
    </div> : null}

    {tab==='activity' ? <div className="card" style={{padding:18}}>
      <h3 style={{marginTop:0}}>Activity</h3>
      <div className="stack">
        {activity.map((row)=><div key={row.id} style={{borderLeft:'3px solid var(--border)',padding:'6px 0 6px 12px'}}><strong>{row.message}</strong><div className="muted">{formatDate(row.date)} · {String(row.type).replace(/_/g,' ')}</div></div>)}
      </div>
    </div> : null}
  </div>;
}
