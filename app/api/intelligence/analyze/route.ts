export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { crawlWebsite } from '@/lib/intelligence/crawler';
import { detectWebsite } from '@/lib/intelligence/detection';
import { analyzeCrawl } from '@/lib/intelligence/analyzer';
import { analyzeCompetitors } from '@/lib/intelligence/competitors';
import { fetchPageSpeed } from '@/lib/intelligence/pageSpeed';
import { createSourceSnapshot } from '@/lib/intelligence/sourceSnapshot';

function clean(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'The website could not be analyzed.');
}

export async function POST(request: NextRequest) {
  let workspaceId = '';
  let businessId = '';
  try {
    const body = await request.json();
    workspaceId = clean(body.workspace_id, 80);
    businessId = clean(body.business_id, 80);
    const { user } = await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();

    let website = clean(body.website);
    let prospectName = clean(body.prospect_name, 120);
    let targetCountry = clean(body.target_country, 80);
    let targetCity = clean(body.target_city, 80);

    if (businessId) {
      const { data: business, error } = await supabase
        .from('businesses')
        .select('id,name,website,location,raw')
        .eq('workspace_id', workspaceId)
        .eq('id', businessId)
        .single();
      if (error || !business) throw new Error(error?.message || 'Prospect not found.');
      website ||= clean(business.website);
      prospectName ||= clean(business.name, 120);
      if (!targetCountry) {
        const raw = business.raw && typeof business.raw === 'object' ? business.raw : {};
        targetCountry = clean((raw as Record<string, unknown>).country || business.location, 80);
      }
    }

    if (!website) throw new Error('Enter a website to analyze.');
    const competitorUrls = Array.isArray(body.competitor_urls)
      ? body.competitor_urls.map((item: unknown) => clean(item)).filter(Boolean).slice(0, 3)
      : clean(body.competitor_urls).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 3);

    const input = {
      website,
      targetCountry,
      targetCity,
      prospectName,
      agencyName: clean(body.agency_name, 120) || 'Scout',
      competitorUrls,
    };

    const crawl = await crawlWebsite(website);
    const detection = detectWebsite(crawl);
    const [competitors, pageSpeed] = await Promise.all([
      analyzeCompetitors(competitorUrls),
      fetchPageSpeed(crawl.finalUrl),
    ]);
    const extras = { competitors, pageSpeed, detection };
    const analysis = analyzeCrawl(crawl, input, extras);
    const sourceSnapshot = createSourceSnapshot(crawl, extras);

    const scanPayload = {
      workspace_id: workspaceId,
      business_id: businessId || null,
      website: analysis.input.website,
      hostname: analysis.business.hostname,
      prospect_name: analysis.business.name,
      status: analysis.scanHealth?.status === 'partial' ? 'partial' : 'complete',
      industry: analysis.classification?.industry || null,
      subindustry: analysis.classification?.subindustry?.name || null,
      opportunity_score: Number(analysis.summary?.opportunityScore || 0),
      readiness_score: Number(analysis.summary?.customerExperienceReadiness || 0),
      prospect_priority: Number(analysis.summary?.prospectPriority?.score || 0),
      confidence: Number(analysis.summary?.confidence || 0),
      analysis,
      source_snapshot: sourceSnapshot,
      created_by: user.id,
    };

    const { data: scan, error: scanError } = await supabase
      .from('opportunity_scans')
      .insert(scanPayload)
      .select('id,created_at')
      .single();
    if (scanError) throw scanError;

    if (businessId) {
      await supabase.from('businesses').update({
        opportunity_score: Number(analysis.summary?.opportunityScore || 0),
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId).eq('id', businessId);
    }

    return NextResponse.json({ analysis, scan });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: Number((error as any)?.status || 422) });
  }
}
