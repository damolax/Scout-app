import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { chooseBestEmailCandidate, type EmailCandidateDecision } from '@/lib/email-candidate-rules';
import { findEmailsDeepFromWebsite, type DeepWebsiteFinderResult } from '@/lib/website-email-finder';

function errorMessage(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const e = error as { message?: string; code?: string; details?: string; hint?: string };
    return [e.message, e.code ? `Code: ${e.code}` : '', e.details ? `Details: ${e.details}` : '', e.hint ? `Hint: ${e.hint}` : ''].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch { return String(error); }
}


function sourceEvidenceFromPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const direct = payload.sourceUrl || payload.source_url || payload.foundOn || payload.found_on || payload.contactPage || payload.contact_page || payload.page || payload.evidenceUrl || payload.evidence_url; // Do not treat a generic payload.website as proof that an email was seen on that page.
  if (direct) return String(direct);
  const arrays = [payload.sources, payload.pages, payload.urls, payload.links, payload.evidence];
  for (const item of arrays) {
    if (Array.isArray(item) && item.length) {
      const first = item.find(Boolean);
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') return String(first.url || first.href || first.page || first.source || '');
    }
  }
  return '';
}

function resultQuality(payload: any): { sourceEvidence: string; quality: string; score: number } {
  const sourceEvidence = sourceEvidenceFromPayload(payload);
  const generated = Boolean(payload?.generated || payload?.guessed || payload?.pattern || String(payload?.method || '').toLowerCase().includes('guess'));
  if (sourceEvidence) return { sourceEvidence, quality: 'source_seen', score: 82 };
  if (generated) return { sourceEvidence, quality: 'generated_only', score: 30 };
  return { sourceEvidence, quality: 'unverified_candidate', score: 45 };
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

function bestEmailDecisionFromPayload(payload: any, business: any) {
  const sourceEvidence = sourceEvidenceFromPayload(payload);
  const generated = backendMarkedGenerated(payload);
  return chooseBestEmailCandidate(payload, business, sourceEvidence, generated);
}

function shouldDeepSearch(decision: EmailCandidateDecision) {
  if (!decision.email) return true;
  if (!decision.valid) return true;
  if (!decision.promote) return true;
  if (decision.quality === 'unverified_candidate') return true;
  return false;
}

function mergeResearchDecision(backendResult: any, backendDecision: EmailCandidateDecision, deepResult: DeepWebsiteFinderResult | null) {
  const deepDecision = deepResult?.decision;
  if (deepDecision?.email && deepDecision.valid && deepDecision.promote) {
    return {
      decision: deepDecision,
      method: 'deep_website_finder',
      payload: { backend: backendResult, backendDecision, deepWebsiteFinder: deepResult },
      reason: deepResult?.reason || deepDecision.reasons.join(' ')
    };
  }
  if (backendDecision.email && backendDecision.valid && backendDecision.promote) {
    return {
      decision: backendDecision,
      method: 'backend_finder',
      payload: { backend: backendResult, backendDecision, deepWebsiteFinder: deepResult },
      reason: backendDecision.reasons.join(' ') || 'Backend returned a promoted email candidate.'
    };
  }
  if (deepDecision?.email && deepDecision.valid) {
    return {
      decision: deepDecision,
      method: 'deep_website_candidate',
      payload: { backend: backendResult, backendDecision, deepWebsiteFinder: deepResult },
      reason: deepResult?.reason || deepDecision.reasons.join(' ')
    };
  }
  if (backendDecision.email && backendDecision.valid) {
    return {
      decision: backendDecision,
      method: 'backend_candidate',
      payload: { backend: backendResult, backendDecision, deepWebsiteFinder: deepResult },
      reason: backendDecision.reasons.join(' ') || 'Backend returned a candidate that needs evidence.'
    };
  }
  return {
    decision: deepDecision || backendDecision,
    method: 'no_trusted_email',
    payload: { backend: backendResult, backendDecision, deepWebsiteFinder: deepResult },
    reason: [backendDecision.reasons.join(' '), deepResult?.reason].filter(Boolean).join(' | ') || 'No trusted email found.'
  };
}


async function callBackendFindEmail(business: any) {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) throw new Error('NEXT_PUBLIC_BACKEND_URL is not configured.');
  const base = backend.endsWith('/') ? backend : `${backend}/`;
  const paths = ['/find-email', '/email-finder/find', '/api/find-email', '/research/find-email'];
  const payload = {
    name: business.name,
    businessName: business.name,
    website: business.website,
    domain: business.domain,
    location: business.location,
    category: business.category,
    raw: business.raw
  };
  const errors: string[] = [];
  for (const path of paths) {
    const target = new URL(path, base);
    try {
      const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const text = await response.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : {}; } catch { json = { rawText: text }; }
      if (response.ok) return json;
      errors.push(`${path}: ${json?.error || json?.message || response.status}`);
    } catch (error) {
      errors.push(`${path}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`No backend email-finder endpoint succeeded. ${errors.join(' | ')}`);
}

async function runOnce(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const supplied = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret');
    const userAgent = request.headers.get('user-agent') || '';
    const isVercelCron = userAgent.toLowerCase().includes('vercel-cron');
    if (!isVercelCron && supplied !== cronSecret) {
      return NextResponse.json({ success: false, error: 'Unauthorized cron request.' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const limit = Math.max(1, Math.min(500, Number(request.nextUrl.searchParams.get('limit') || 100)));
  const concurrency = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get('concurrency') || 20)));

  const { data: jobs, error: jobError } = await supabase
    .from('email_research_jobs')
    .select('id,workspace_id,business_id,attempts,businesses(id,name,email,website,domain,category,location,raw,status)')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (jobError) throw jobError;

  const results: Array<Record<string, unknown>> = [];

  async function processJob(job: any) {
    const business = Array.isArray(job.businesses) ? job.businesses[0] : job.businesses;
    if (!business) {
      await supabase.from('email_research_jobs').update({ status: 'failed', last_error: 'Business not found', finished_at: new Date().toISOString() }).eq('id', job.id);
      results.push({ job: job.id, status: 'failed', error: 'Business not found' });
      return;
    }

    await supabase.from('email_research_jobs').update({ status: 'running', started_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 }).eq('id', job.id);
    await supabase.from('businesses').update({ status: 'scanning' }).eq('id', business.id).neq('status', 'contacted');

    try {
      let backendResult: any = {};
      let backendError = '';
      try {
        backendResult = await callBackendFindEmail(business);
      } catch (error) {
        backendError = errorMessage(error);
        backendResult = { success: false, error: backendError, method: 'backend_unavailable' };
      }

      const backendDecision = bestEmailDecisionFromPayload(backendResult, business);
      let deepResult: DeepWebsiteFinderResult | null = null;
      if (shouldDeepSearch(backendDecision)) {
        deepResult = await findEmailsDeepFromWebsite(business, { maxPages: 7, timeoutMs: 6500 });
      }

      const merged = mergeResearchDecision(backendResult, backendDecision, deepResult);
      const decision = merged.decision;
      const email = decision.email;
      const enrichedResult = { ...merged.payload, email, emailDecision: decision, quality: decision.quality, sourceEvidence: decision.sourceEvidence, method: merged.method, backendError };

      if (email && decision.valid && decision.promote) {
        await supabase.from('email_candidates').upsert({
          workspace_id: job.workspace_id,
          business_id: business.id,
          email,
          source: merged.method === 'deep_website_finder' ? `deep_${deepResult?.sourceType || 'website'}` : (decision.sourceEvidence ? 'backend_source_seen' : 'backend_domain_match'),
          score: decision.score,
          status: decision.sourceEvidence ? 'source_seen_candidate' : 'domain_match_candidate',
          raw: enrichedResult
        }, { onConflict: 'workspace_id,business_id,email' });
        await supabase.from('businesses').update({ email, status: 'found', score: decision.score, raw: { ...(business.raw || {}), backend_email_research: enrichedResult } }).eq('id', business.id);
        await supabase.from('email_research_jobs').update({ status: 'done', result: enrichedResult, finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        results.push({ job: job.id, business: business.id, businessName: business.name, status: 'found', email, method: merged.method, quality: decision.quality, evidence: decision.sourceEvidence, pagesChecked: deepResult?.pagesChecked || 0, reason: merged.reason || 'Email passed strict candidate rules.' });
      } else if (email && decision.valid && !decision.promote) {
        await supabase.from('email_candidates').upsert({
          workspace_id: job.workspace_id,
          business_id: business.id,
          email,
          source: merged.method,
          score: decision.score,
          status: 'needs_evidence',
          raw: enrichedResult
        }, { onConflict: 'workspace_id,business_id,email' });
        await supabase.from('businesses').update({ status: 'review', raw: { ...(business.raw || {}), backend_email_research: enrichedResult } }).eq('id', business.id);
        await supabase.from('email_research_jobs').update({ status: 'done', result: enrichedResult, finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        results.push({ job: job.id, business: business.id, businessName: business.name, status: 'candidate_needs_evidence', email, method: merged.method, quality: decision.quality, evidence: decision.sourceEvidence, pagesChecked: deepResult?.pagesChecked || 0, reason: merged.reason || 'Valid format, but not trusted enough to promote.' });
      } else {
        await supabase.from('businesses').update({ status: 'review', raw: { ...(business.raw || {}), backend_email_research: enrichedResult } }).eq('id', business.id);
        await supabase.from('email_research_jobs').update({ status: 'done', result: enrichedResult, finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        results.push({ job: job.id, business: business.id, businessName: business.name, status: 'no_trusted_email_found', method: merged.method, pagesChecked: deepResult?.pagesChecked || 0, rejected: decision.rejected, reason: merged.reason });
      }
    } catch (error) {
      const attempts = (job.attempts || 0) + 1;
      const nextStatus = attempts >= 3 ? 'failed' : 'queued';
      await supabase.from('email_research_jobs').update({ status: nextStatus, attempts, last_error: errorMessage(error), finished_at: nextStatus === 'failed' ? new Date().toISOString() : null }).eq('id', job.id);
      if (nextStatus === 'failed') await supabase.from('businesses').update({ status: 'review' }).eq('id', business.id);
      results.push({ job: job.id, business: business.id, businessName: business.name, status: nextStatus, error: errorMessage(error) });
    }
  }

  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, (jobs || []).length) }, async () => {
    while (cursor < (jobs || []).length) {
      const index = cursor++;
      await processJob((jobs || [])[index]);
    }
  });
  await Promise.all(runners);

  return NextResponse.json({ success: true, processed: results.length, results });
}

export async function GET(request: NextRequest) {
  try { return await runOnce(request); }
  catch (error) { return NextResponse.json({ success: false, error: errorMessage(error), raw: error }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try { return await runOnce(request); }
  catch (error) { return NextResponse.json({ success: false, error: errorMessage(error), raw: error }, { status: 500 }); }
}
