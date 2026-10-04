'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { Business, BusinessStatus, Workspace } from '@/lib/types';

const PAGE_SIZE = 75;
const STATUS_OPTIONS: BusinessStatus[] = ['pending','scanning','found','ready','review','contacted','responded','no_inbox','bounced','invalid','duplicate','archived'];
const TYPE_OPTIONS = [
  ['all','All prospects'],
  ['author','Authors'],
  ['shopify','Shopify'],
  ['website_design','Website Design'],
  ['automation','Automation'],
  ['planner','Planner'],
  ['custom','Custom'],
  ['business','General Business'],
] as const;

function typeLabel(value: unknown) {
  const key = String(value || 'business').toLowerCase();
  return TYPE_OPTIONS.find(([id]) => id === key)?.[1] || key.replace(/_/g,' ').replace(/\b\w/g,(m)=>m.toUpperCase());
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
}

function downloadRows(rows: Business[]) {
  if (!rows.length) return;
  const headers = ['name','prospect_type','email','phone','website','category','location','qualification_score','opportunity_score','status','source','created_at'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const record = row as unknown as Record<string,unknown>;
    lines.push(headers.map((key)=>csvEscape(record[key])).join(','));
  }
  const blob = new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='scout-prospects.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function ProspectsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(()=>createClient(),[]);
  const [rows,setRows]=useState<Business[]>([]);
  const [type,setType]=useState('all');
  const [status,setStatus]=useState('all');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [total,setTotal]=useState(0);
  const [counts,setCounts]=useState<Record<string,number>>({});
  const [loading,setLoading]=useState(false);
  const [busyId,setBusyId]=useState('');
  const [error,setError]=useState('');

  async function loadCounts() {
    const next: Record<string,number> = {};
    const { count: allCount } = await supabase.from('businesses').select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id);
    next.all=allCount||0;
    await Promise.all(TYPE_OPTIONS.filter(([id])=>id!=='all').map(async ([id])=>{
      const query = id === 'business'
        ? supabase.from('businesses').select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id).or('prospect_type.is.null,prospect_type.eq.business')
        : supabase.from('businesses').select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id).eq('prospect_type',id);
      const { count } = await query;
      next[id]=count||0;
    }));
    setCounts(next);
  }

  async function load(nextPage=page) {
    setLoading(true); setError('');
    try {
      const from=nextPage*PAGE_SIZE;
      let query=supabase.from('businesses').select('*',{count:'exact'}).eq('workspace_id',workspace.id).order('created_at',{ascending:false}).range(from,from+PAGE_SIZE-1);
      if(type!=='all') {
        query = type==='business' ? query.or('prospect_type.is.null,prospect_type.eq.business') : query.eq('prospect_type',type);
      }
      if(status!=='all') query=query.eq('status',status);
      const clean=search.trim().replace(/[%_]/g,'');
      if(clean) query=query.or(`name.ilike.%${clean}%,email.ilike.%${clean}%,website.ilike.%${clean}%,domain.ilike.%${clean}%,category.ilike.%${clean}%,location.ilike.%${clean}%`);
      const {data,count,error}=await query;
      if(error) throw error;
      setRows((data||[]) as Business[]); setTotal(count||0); setPage(nextPage);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  }

  useEffect(()=>{ load(0); loadCounts().catch(()=>undefined); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[type,status]);

  async function queueEmailResearch(row: Business) {
    setBusyId(row.id); setError('');
    try {
      const response=await fetch('/api/research/enqueue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:workspace.id,businessIds:[row.id],limit:1})});
      const json=await response.json();
      if(!response.ok||json.success===false) throw new Error(json.error||'Could not queue email research.');
      await load(page);
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusyId('');}
  }

  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));

  return <div className="stack">
    <div className="grid grid-4">
      {TYPE_OPTIONS.slice(0,4).map(([id,label])=><button type="button" key={id} className={'card kpi '+(type===id?'active':'')} style={{textAlign:'left',cursor:'pointer'}} onClick={()=>{setType(id);setPage(0);}}>
        <div className="title">{label}</div><div className="num">{Number(counts[id]||0).toLocaleString()}</div>
      </button>)}
    </div>

    <div className="card" style={{padding:18}}>
      <div className="actions" style={{justifyContent:'space-between'}}>
        <div className="actions" style={{flex:1}}>
          <input className="input" style={{maxWidth:330}} value={search} onChange={(e)=>setSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') load(0);}} placeholder="Search name, email, website, country…" />
          <select className="select" style={{maxWidth:190}} value={type} onChange={(e)=>{setType(e.target.value);setPage(0);}}>
            {TYPE_OPTIONS.map(([id,label])=><option key={id} value={id}>{label} ({Number(counts[id]||0).toLocaleString()})</option>)}
          </select>
          <select className="select" style={{maxWidth:170}} value={status} onChange={(e)=>{setStatus(e.target.value);setPage(0);}}>
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((item)=><option key={item} value={item}>{item.replace(/_/g,' ')}</option>)}
          </select>
          <button className="btn secondary" type="button" onClick={()=>load(0)} disabled={loading}>Search</button>
        </div>
        <div className="actions">
          <button className="btn secondary" type="button" onClick={()=>downloadRows(rows)} disabled={!rows.length}>Export page</button>
          <Link className="btn" href="/scout">+ New Scout</Link>
        </div>
      </div>
      {error ? <div className="error" style={{marginTop:12}}>{error}</div> : null}
    </div>

    <div className="card" style={{padding:18}}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Prospect</th><th>Type</th><th>Contact</th><th>Opportunity</th><th>Status</th><th>Source</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row)=> <tr key={row.id}>
              <td>
                <Link href={'/prospects/'+row.id}><strong>{row.name||row.website||row.email||'Unnamed prospect'}</strong></Link><br />
                <span className="muted">{row.category||''}{row.location?' · '+row.location:''}</span>
              </td>
              <td><span className="badge">{typeLabel(row.prospect_type)}</span></td>
              <td>{row.email ? <><strong>{row.email}</strong><br /><span className="muted">Email found</span></> : <span className="muted">No email yet</span>}</td>
              <td>{row.opportunity_score==null ? <span className="muted">Not analyzed</span> : <><strong>{row.opportunity_score}/100</strong><br /><span className="muted">Opportunity score</span></>}</td>
              <td><span className={'status '+row.status}>{row.status.replace(/_/g,' ')}</span></td>
              <td>{row.source||'Scout'}</td>
              <td><div className="actions">
                <Link className="btn secondary" href={'/prospects/'+row.id}>Open</Link>
                {row.website ? <Link className="btn secondary" href={'/intelligence?business='+encodeURIComponent(row.id)}>Analyze</Link> : null}
                {row.email ? <Link className="btn secondary" href={'/outreach?prospect='+encodeURIComponent(row.id)}>Send</Link> : <button className="btn secondary" type="button" disabled={busyId===row.id} onClick={()=>queueEmailResearch(row)}>{busyId===row.id?'Queueing…':'Find email'}</button>}
              </div></td>
            </tr>)}
            {!rows.length ? <tr><td colSpan={7} className="muted">No matching prospects. Start a Scout, change the filters, or upload a list.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{justifyContent:'space-between',marginTop:14}}>
        <button className="btn secondary" type="button" disabled={page<=0||loading} onClick={()=>load(page-1)}>Previous</button>
        <span className="muted">Page {page+1} of {pages.toLocaleString()} · {total.toLocaleString()} prospects</span>
        <button className="btn secondary" type="button" disabled={page+1>=pages||loading} onClick={()=>load(page+1)}>Next</button>
      </div>
    </div>

    <div className="notice">
      Need the old queue-management tools? <Link href="/businesses">Open Advanced Queue</Link>.
    </div>
  </div>;
}
