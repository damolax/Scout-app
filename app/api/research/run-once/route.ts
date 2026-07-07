import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

function errorMessage(error: unknown) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const e = error as { message?: string; code?: string; details?: string; hint?: string };
    return [e.message, e.code ? `Code: ${e.code}` : '', e.details ? `Details: ${e.details}` : '', e.hint ? `Hint: ${e.hint}` : ''].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch { return String(error); }
}

function bestEmailFromPayload(payload: any): string {
  const candidates = [
    payload?.email,
    payload?.bestEmail,
    payload?.best_email,
    payload?.validatedEmail,
    payload?.result?.email,
    payload?.result?.bestEmail,
    payload?.data?.email,
    payload?.data?.bestEmail,
    Array.isArray(payload?.emails) ? payload.emails[0] : '',
    Array.isArray(payload?.result?.emails) ? payload.result.emails[0] : ''
  ];
  return String(candidates.find(Boolean) || '').trim().toLowerCase();
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
      const backendResult = await callBackendFindEmail(business);
      const email = bestEmailFromPayload(backendResult);
      if (email) {
        await supabase.from('email_candidates').upsert({
          workspace_id: job.workspace_id,
          business_id: business.id,
          email,
          source: 'backend_worker',
          score: Number(backendResult?.score || backendResult?.confidence || 80) || 80,
          status: 'candidate',
          raw: backendResult
        }, { onConflict: 'workspace_id,business_id,email' });
        await supabase.from('businesses').update({ email, status: 'found', raw: { ...(business.raw || {}), backend_email_research: backendResult } }).eq('id', business.id);
        await supabase.from('email_research_jobs').update({ status: 'done', result: backendResult, finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        results.push({ job: job.id, business: business.id, businessName: business.name, status: 'found', email });
      } else {
        await supabase.from('businesses').update({ status: 'review', raw: { ...(business.raw || {}), backend_email_research: backendResult } }).eq('id', business.id);
        await supabase.from('email_research_jobs').update({ status: 'done', result: backendResult, finished_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        results.push({ job: job.id, business: business.id, businessName: business.name, status: 'no_email_found' });
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
