export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { ensureUnifiedScoutWorker } from '@/lib/scout-worker';

const TYPES = new Set(['shopify','website_design','automation','planner','custom','business']);

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Scout request failed.');
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspace_id') || '');
    await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('scout_runs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('scout_type', 'author')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return NextResponse.json({ runs: data || [] });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: Number((error as any)?.status || 400) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspace_id || '');
    const action = String(body.action || 'start');
    const { user } = await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();

    if (action === 'stop') {
      const runId = String(body.run_id || '');
      if (!runId) throw new Error('run_id is required.');
      const { data, error } = await supabase.from('scout_runs').update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        progress_text: 'Stopped by user. Prospects already found remain saved.',
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId).eq('id', runId).in('status', ['queued','running','paused']).select('*').maybeSingle();
      if (error) throw error;
      return NextResponse.json({ success: true, run: data });
    }

    const type = String(body.scout_type || 'custom').trim().toLowerCase();
    if (!TYPES.has(type)) throw new Error('Unsupported Scout type.');
    const durationMinutes = Math.max(1, Math.min(10080, Number(body.duration_minutes || 30)));
    const targetCount = Math.max(0, Math.min(100000, Number(body.target_count || 0)));
    const filters = {
      niche: String(body.niche || '').trim().slice(0, 160),
      location: String(body.location || '').trim().slice(0, 120),
      country: String(body.country || '').trim().slice(0, 120),
      category: String(body.category || '').trim().slice(0, 160),
      signals: Array.isArray(body.signals) ? body.signals.slice(0, 20) : String(body.signals || '').split(/[\n,]+/).map((v) => v.trim()).filter(Boolean).slice(0, 20),
      max_pages: Math.max(4, Math.min(10, Number(body.max_pages || 7))),
      max_search_queries: Math.max(1, Math.min(5, Number(body.max_search_queries || 3))),
    };
    if (!filters.niche && type === 'custom') throw new Error('Describe the custom niche you want Scout to find.');

    const { data, error } = await supabase.from('scout_runs').insert({
      workspace_id: workspaceId,
      scout_type: type,
      status: 'queued',
      target_count: targetCount || null,
      filters,
      raw: { duration_minutes: durationMinutes, cycle: 0, background: true },
      requested_by: user.id,
      progress_text: 'Queued for background scouting.',
    }).select('*').single();
    if (error) throw error;
    const worker = await ensureUnifiedScoutWorker(request.nextUrl.origin);
    return NextResponse.json({
      success: true,
      run: data,
      worker,
      warning: worker.ready ? null : 'Scout was queued, but the background worker still needs setup: ' + String(worker.error || 'unknown worker error'),
    });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: Number((error as any)?.status || 400) });
  }
}
