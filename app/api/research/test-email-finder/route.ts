export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient as createServerSupabaseClient } from '@/lib/supabase-server';
import { chooseBestEmailCandidate } from '@/lib/email-candidate-rules';
import { findEmailsDeepFromWebsite, type DeepWebsiteFinderResult } from '@/lib/website-email-finder';

function errorMessage(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function signedInMemberCanRun(workspaceId: string) {
  if (!workspaceId) return false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return false;
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,user_id,approved')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('approved', true)
      .limit(1);
    if (memberError) return false;
    return Boolean(member);
  } catch {
    return false;
  }
}

function sourceEvidenceFromPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const direct = payload.sourceUrl || payload.source_url || payload.foundOn || payload.found_on || payload.contactPage || payload.contact_page || payload.page || payload.evidenceUrl || payload.evidence_url;
  if (direct) return String(direct);
  const arrays = [payload.sources, payload.pages, payload.urls, payload.links, payload.evidence, payload.checkedPages, payload.checked_pages];
  for (const item of arrays) {
    if (Array.isArray(item) && item.length) {
      const first = item.find(Boolean);
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') return String(first.url || first.href || first.page || first.source || '');
    }
  }
  return '';
}

function backendMarkedGenerated(payload: any): boolean {
  return Boolean(
    payload?.generated ||
    payload?.guessed ||
    payload?.pattern ||
    payload?.isGuess ||
    String(payload?.method || '').toLowerCase().includes('guess') ||
    String(payload?.source || '').toLowerCase().includes('guess') ||
    String(payload?.reason || '').toLowerCase().includes('generated')
  );
}

function bestDecisionFromPayload(payload: any, business: any) {
  const sourceEvidence = sourceEvidenceFromPayload(payload);
  const generated = backendMarkedGenerated(payload);
  return chooseBestEmailCandidate(payload, business, sourceEvidence, generated);
}

function flattenPageList(payload: any, deepResult?: DeepWebsiteFinderResult | null) {
  const pages = new Set<string>();
  const add = (value: unknown) => {
    const text = String(value || '').trim();
    if (text && /^https?:\/\//i.test(text)) pages.add(text);
  };
  if (deepResult?.pages?.length) deepResult.pages.forEach((page) => add(page.url));
  const possible = [payload?.pages, payload?.checkedPages, payload?.checked_pages, payload?.urls, payload?.sources, payload?.evidence];
  for (const item of possible) {
    if (!Array.isArray(item)) continue;
    for (const row of item) {
      if (typeof row === 'string') add(row);
      else if (row && typeof row === 'object') add(row.url || row.href || row.page || row.source);
    }
  }
  return Array.from(pages).slice(0, 20);
}

async function callRenderHealth() {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) return { configured: false, reachable: false, url: '', status: 0, ok: false, error: 'NEXT_PUBLIC_BACKEND_URL is not configured.' };
  const base = backend.endsWith('/') ? backend.slice(0, -1) : backend;
  try {
    const response = await fetch(base, { method: 'GET', cache: 'no-store' });
    const text = await response.text().catch(() => '');
    return { configured: true, reachable: response.ok, url: base, status: response.status, ok: response.ok, body: text.slice(0, 500) };
  } catch (error) {
    return { configured: true, reachable: false, url: base, status: 0, ok: false, error: errorMessage(error) };
  }
}

async function callBackendFindEmail(business: any) {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) throw new Error('NEXT_PUBLIC_BACKEND_URL is not configured.');
  const base = backend.endsWith('/') ? backend : `${backend}/`;
  const paths = ['/find-email', '/api/find-email', '/email-finder/find', '/api/email/find', '/research/find-email', '/api/research/find-email', '/find', '/api/find'];
  const payload = {
    name: business.name,
    businessName: business.name,
    website: business.website,
    domain: business.domain,
    location: business.location,
    category: business.category,
    raw: business.raw
  };
  const attempts: Array<{ path: string; ok: boolean; status?: number; error?: string }> = [];
  for (const path of paths) {
    const target = new URL(path, base);
    try {
      const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
      const text = await response.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { rawText: text }; }
      attempts.push({ path, ok: response.ok, status: response.status, error: response.ok ? '' : String(json?.error || json?.message || text || response.status).slice(0, 240) });
      if (response.ok) return { ok: true, path, status: response.status, json, attempts };
    } catch (error) {
      attempts.push({ path, ok: false, error: errorMessage(error) });
    }
  }
  return { ok: false, path: '', status: 0, json: null, attempts, error: `No Render email-finder endpoint succeeded. ${attempts.map((item) => `${item.path}: ${item.error || item.status}`).join(' | ')}` };
}

function chooseFinalDecision(backendResult: any, deepResult: DeepWebsiteFinderResult | null, business: any) {
  const backendPayload = backendResult?.json || backendResult || {};
  const backendDecision = bestDecisionFromPayload(backendPayload, business);
  const deepDecision = deepResult?.decision;
  if (deepDecision?.email && deepDecision.valid && deepDecision.promote) {
    return { email: deepDecision.email, source: 'website_pages', promoted: true, quality: deepDecision.quality, score: deepDecision.score, evidence: deepDecision.sourceEvidence || deepResult?.sourceUrl || '', reasons: deepDecision.reasons };
  }
  if (backendDecision.email && backendDecision.valid && backendDecision.promote) {
    return { email: backendDecision.email, source: 'render_backend', promoted: true, quality: backendDecision.quality, score: backendDecision.score, evidence: backendDecision.sourceEvidence, reasons: backendDecision.reasons };
  }
  if (deepDecision?.email && deepDecision.valid) {
    return { email: deepDecision.email, source: 'website_pages_review', promoted: false, quality: deepDecision.quality, score: deepDecision.score, evidence: deepDecision.sourceEvidence || deepResult?.sourceUrl || '', reasons: deepDecision.reasons };
  }
  if (backendDecision.email && backendDecision.valid) {
    return { email: backendDecision.email, source: 'render_backend_review', promoted: false, quality: backendDecision.quality, score: backendDecision.score, evidence: backendDecision.sourceEvidence, reasons: backendDecision.reasons };
  }
  return { email: '', source: 'none', promoted: false, quality: 'none', score: 0, evidence: '', reasons: [backendDecision.reasons.join(' '), deepResult?.reason].filter(Boolean) };
}

async function testOneWebsite(body: any) {
  const workspaceId = String(body.workspaceId || '').trim();
  if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });
  if (!(await signedInMemberCanRun(workspaceId))) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  const businessId = String(body.businessId || '').trim();
  let business: any = {
    id: businessId || 'manual-test',
    name: String(body.businessName || 'Manual website test').trim(),
    website: String(body.website || '').trim(),
    domain: String(body.domain || '').trim(),
    location: '',
    category: '',
    raw: {}
  };

  if (businessId) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('businesses')
      .select('id,name,email,website,domain,category,location,raw,status')
      .eq('workspace_id', workspaceId)
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: 'Selected lead was not found.' }, { status: 404 });
    business = data;
  }

  if (!String(business.website || business.domain || '').trim()) {
    return NextResponse.json({ success: false, error: 'Add a website URL first. This test is website-first.' }, { status: 400 });
  }

  const renderHealth = await callRenderHealth();
  const backend = await callBackendFindEmail(business);
  let deepResult: DeepWebsiteFinderResult | null = null;
  let deepError = '';
  try {
    deepResult = await findEmailsDeepFromWebsite(business, { maxPages: 10, timeoutMs: 8000 });
  } catch (error) {
    deepError = errorMessage(error);
  }
  const finalDecision = chooseFinalDecision(backend, deepResult, business);
  return NextResponse.json({
    success: true,
    mode: 'one_website',
    saved: false,
    saveNote: 'One-website test does not save automatically. It proves whether the finder can see a usable email.',
    business: { id: business.id, name: business.name, website: business.website || business.domain || '' },
    render: renderHealth,
    backend: {
      ok: backend.ok,
      endpoint: backend.path,
      status: backend.status,
      error: backend.error || '',
      attempts: backend.attempts,
      email: bestDecisionFromPayload(backend.json || {}, business).email,
      decision: bestDecisionFromPayload(backend.json || {}, business)
    },
    websitePages: {
      ok: Boolean(deepResult?.success),
      error: deepError,
      pagesChecked: deepResult?.pagesChecked || 0,
      pagesAttempted: deepResult?.pagesAttempted || 0,
      sourceUrl: deepResult?.sourceUrl || '',
      email: deepResult?.email || '',
      decision: deepResult?.decision || null,
      pages: flattenPageList(backend.json, deepResult)
    },
    finalDecision
  });
}

async function testQueuedLeads(request: NextRequest, body: any) {
  const workspaceId = String(body.workspaceId || '').trim();
  if (!workspaceId) return NextResponse.json({ success: false, error: 'Missing workspaceId.' }, { status: 400 });
  if (!(await signedInMemberCanRun(workspaceId))) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  const origin = request.nextUrl.origin;
  const url = new URL('/api/research/run-once', origin);
  url.searchParams.set('workspaceId', workspaceId);
  url.searchParams.set('limit', '5');
  url.searchParams.set('concurrency', '2');
  const secret = process.env.CRON_SECRET || process.env.AUTO_SCOUT_WORKER_SECRET || process.env.RUN_ALL_WORKER_SECRET || '';
  if (secret) url.searchParams.set('secret', secret);
  const response = await fetch(url, { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : undefined, cache: 'no-store' });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || !json.success) {
    return NextResponse.json({ success: false, mode: 'five_queued', error: json?.error || `Queued test failed with HTTP ${response.status}`, runOnce: json }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    mode: 'five_queued',
    saved: true,
    saveNote: 'This test uses real queued leads. If an email passes the rules, Scout saves it to that lead.',
    render: await callRenderHealth(),
    processed: Number(json.processed || 0),
    found: Array.isArray(json.results) ? json.results.filter((row: any) => row?.email || row?.status === 'found').length : 0,
    results: Array.isArray(json.results) ? json.results.slice(0, 5) : [],
    runOnce: json
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || '').trim();
    if (mode === 'queued5') return await testQueuedLeads(request, body);
    return await testOneWebsite(body);
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
