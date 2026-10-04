export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { authorScoutRequest } from '@/lib/author-scout-bridge';
import { cleanText, displayDomain, makeNormalizedKey, normalizeEmail, normalizeWebsite } from '@/lib/normalize';

function err(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Author Scout request failed.');
}

async function workspaceRow(workspaceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('workspaces').select('id,name').eq('id', workspaceId).single();
  if (error || !data) throw new Error(error?.message || 'Workspace not found.');
  return data;
}

async function syncAuthorResults(workspaceId: string, userId: string, results: any[]) {
  if (!results?.length) return { inserted: 0 };
  const supabase = createAdminClient();
  const payload = results.map((row) => {
    const email = normalizeEmail(row.email);
    const website = normalizeWebsite(row.website);
    const name = cleanText(row.name);
    const normalizedKey = makeNormalizedKey({ email, website, name: name + ' ' + cleanText(row.country) });
    return {
      workspace_id: workspaceId,
      name: name || null,
      person_name: name || null,
      email: email || null,
      website: website || null,
      domain: displayDomain({ website, email }) || null,
      category: cleanText(row.genre) || 'Author',
      location: cleanText(row.country) || null,
      source: 'author_scout_background',
      prospect_type: 'author',
      status: email ? 'ready' : 'found',
      score: Number(row.discovery_confidence || 0) || null,
      qualification_score: Number(row.discovery_confidence || 0) || null,
      normalized_key: normalizedKey || ('author:' + String(row.id || randomUUID())),
      raw: {
        authorScout: true,
        authorScoutProspectId: row.id || null,
        genre: row.genre || null,
        country: row.country || null,
        verificationStatus: row.verification_status || null,
        emailSourceUrl: row.email_source_url || null,
        discoveryPlatform: row.discovery_platform || null,
        discoverySourceType: row.discovery_source_type || null,
        discoverySourceUrl: row.discovery_source_url || null,
        discoveryQuery: row.discovery_query || null,
        discoveryEvidence: row.discovery_evidence || null,
        claimedAt: row.claimed_at || null,
      },
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
  }).filter((row) => row.normalized_key);

  const { data, error } = await supabase
    .from('businesses')
    .upsert(payload, { onConflict: 'workspace_id,normalized_key', ignoreDuplicates: false })
    .select('id');
  if (error) throw error;
  return { inserted: data?.length || 0 };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspace_id') || '');
    const jobId = String(request.nextUrl.searchParams.get('job_id') || '');
    const { user } = await requireWorkspaceAccess(workspaceId);
    const workspace = await workspaceRow(workspaceId);
    const json = jobId
      ? await authorScoutRequest(workspace, '/api/v1/research/jobs/' + encodeURIComponent(jobId))
      : await authorScoutRequest(workspace, '/api/v1/research/jobs?limit=30');

    if (jobId && Array.isArray(json.results)) {
      const synced = await syncAuthorResults(workspaceId, user.id, json.results);
      return NextResponse.json({ ...json, synced });
    }
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: err(error) }, { status: Number((error as any)?.status || 400) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspace_id || '');
    const action = String(body.action || 'start');
    const { user } = await requireWorkspaceAccess(workspaceId);
    const workspace = await workspaceRow(workspaceId);

    if (action === 'stop') {
      const jobId = String(body.job_id || '');
      if (!jobId) throw new Error('job_id is required.');
      const json = await authorScoutRequest(workspace, '/api/v1/research/jobs/' + encodeURIComponent(jobId) + '/stop', {
        method: 'POST',
        body: '{}',
      });
      return NextResponse.json(json);
    }

    const countries = Array.isArray(body.countries) ? body.countries : [];
    const presetId = cleanText(body.preset_id || 'custom').slice(0, 80) || 'custom';
    const genres = Array.isArray(body.genres) ? body.genres : [];
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const languages = Array.isArray(body.languages) ? body.languages : [];
    const activitySignals = Array.isArray(body.activity_signals) ? body.activity_signals : ['active 2026'];
    const sourceTypes = Array.isArray(body.source_types) ? body.source_types : ['general'];
    const genders = Array.isArray(body.genders) && body.genders.length ? body.genders : ['any'];
    const duration = Math.max(1, Math.min(Number(body.duration_minutes || 10), 10080));

    const supabase = createAdminClient();
    const { data: recentRuns } = await supabase
      .from('scout_runs')
      .select('raw,created_at')
      .eq('workspace_id', workspaceId)
      .eq('scout_type', 'author')
      .order('created_at', { ascending: false })
      .limit(100);
    const presetRunsToday = (recentRuns || []).filter((run: any) => {
      const raw = run.raw && typeof run.raw === 'object' ? run.raw : {};
      return String(raw.preset_id || '') === presetId
        && String(run.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
    }).length;
    const rotationSeed = presetId + ':' + new Date().toISOString().slice(0, 10) + ':' + String(presetRunsToday);

    const requestBody = {
      query: cleanText(body.instructions),
      filters: {
        name: cleanText(body.name),
        year: cleanText(body.year || '2026'),
      },
      presearch: {
        countries,
        genres,
        positions,
        languages,
        genders,
        activity_signals: activitySignals,
        publishing_paths: Array.isArray(body.publishing_paths) ? body.publishing_paths : [],
        source_types: sourceTypes,
        saturation: cleanText(body.saturation || 'low saturation emerging mid-list non-celebrity'),
        require_website: body.require_website !== false,
        require_public_email: body.require_public_email !== false,
      },
      duration_minutes: duration,
      rotation_seed: rotationSeed,
      preset_id: presetId,
    };

    const json = await authorScoutRequest(workspace, '/api/v1/research/jobs', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    const { data: run } = await supabase.from('scout_runs').insert({
      workspace_id: workspaceId,
      scout_type: 'author',
      status: 'queued',
      target_count: Number(json.requested_count || 0) || null,
      filters: requestBody,
      raw: { author_job_id: json.job_id, author_scout: true, preset_id: presetId, rotation_seed: rotationSeed },
      requested_by: user.id,
      progress_text: 'Author Scout queued',
    }).select('id').single();

    return NextResponse.json({ ...json, scout_run_id: run?.id || null, preset_id: presetId, rotation_seed: rotationSeed });
  } catch (error) {
    return NextResponse.json({ error: err(error) }, { status: Number((error as any)?.status || 400) });
  }
}
