export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';

function csv(value: unknown) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspaceId') || '').trim();
    const jobId = String(request.nextUrl.searchParams.get('jobId') || '').trim();
    const kind = String(request.nextUrl.searchParams.get('kind') || 'duplicates').trim();
    await requireWorkspaceAccess(workspaceId);
    if (!jobId) throw new Error('jobId is required.');

    const supabase = createAdminClient();
    const { data: job, error: jobError } = await supabase
      .from('import_jobs').select('id,file_name').eq('workspace_id', workspaceId).eq('id', jobId).single();
    if (jobError || !job) throw new Error(jobError?.message || 'Import job not found.');

    const statuses = kind === 'invalid'
      ? ['invalid']
      : kind === 'suppressed'
        ? ['suppressed']
        : ['duplicate', 'file_duplicate'];
    const rows: Array<Record<string, any>> = [];
    for (let from = 0; from < 100000; from += 1000) {
      const { data, error } = await supabase
        .from('import_job_rows')
        .select('row_no,dedupe_key,status,error_message,row_data')
        .eq('job_id', jobId)
        .in('status', statuses)
        .order('row_no', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const dynamicHeaderSet = rows.reduce<Set<string>>((set, row) => {
      const rowData = row.row_data && typeof row.row_data === 'object'
        ? row.row_data as Record<string, unknown>
        : {};
      const nestedRaw = rowData.raw;
      const raw: Record<string, unknown> = nestedRaw && typeof nestedRaw === 'object' && !Array.isArray(nestedRaw)
        ? nestedRaw as Record<string, unknown>
        : rowData;
      Object.keys(raw).forEach((key) => set.add(key));
      return set;
    }, new Set<string>());
    const dynamicHeaders = Array.from(dynamicHeaderSet);
    const headers = ['row_no', 'status', 'reason', 'dedupe_key', ...dynamicHeaders];
    const lines = [headers.map(csv).join(',')];
    for (const row of rows) {
      const rowData = row.row_data && typeof row.row_data === 'object'
        ? row.row_data as Record<string, unknown>
        : {};
      const nestedRaw = rowData.raw;
      const raw: Record<string, unknown> = nestedRaw && typeof nestedRaw === 'object' && !Array.isArray(nestedRaw)
        ? nestedRaw as Record<string, unknown>
        : rowData;
      const reason = row.error_message || rowData.reason || row.status;
      lines.push([row.row_no, row.status, reason, row.dedupe_key, ...dynamicHeaders.map((key) => raw[key])].map(csv).join(','));
    }
    const safeBase = String(job.file_name || 'scout-import').replace(/\.csv$/i, '').replace(/[^a-z0-9_-]+/gi, '-');
    return new NextResponse(lines.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${safeBase}-${kind}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
