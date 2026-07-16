export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspaceId') || '').trim();
    const search = String(request.nextUrl.searchParams.get('search') || '').trim();
    const filter = String(request.nextUrl.searchParams.get('filter') || 'all').trim();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || 1));
    const pageSize = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('pageSize') || 25)));
    if (!workspaceId) return NextResponse.json({ success: false, error: 'workspaceId is required.' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ success: false, error: userError?.message || 'Not signed in.' }, { status: 401 });

    const { data, error } = await supabase.rpc('scout_sender_accounts_page', {
      p_workspace_id: workspaceId,
      p_search: search,
      p_filter: filter,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const first = rows[0] || {};
    const matching = Number(first.matching_count || 0);
    const total = Number(first.total_count || 0);
    const connected = Number(first.connected_count || 0);
    const paused = Number(first.paused_count || 0);

    const accounts = rows.map((row: Record<string, unknown>) => {
      const { matching_count, total_count, connected_count, paused_count, ...safe } = row;
      return safe;
    });

    return NextResponse.json({
      success: true,
      accounts,
      pagination: {
        page,
        pageSize,
        matching,
        totalPages: Math.max(1, Math.ceil(matching / pageSize)),
      },
      summary: { total, connected, paused },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 500 });
  }
}
