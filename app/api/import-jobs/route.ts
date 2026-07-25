export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = String(request.nextUrl.searchParams.get('workspaceId') || '').trim();
    const jobId = String(request.nextUrl.searchParams.get('jobId') || '').trim();
    await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();
    let query = supabase.from('import_jobs').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(20);
    if (jobId) query = query.eq('id', jobId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, jobs: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const workspaceId = String(body.workspaceId || body.workspace_id || '').trim();
    const access = await requireWorkspaceAccess(workspaceId);
    const supabase = createAdminClient();

    if (action === 'create') {
      const id = crypto.randomUUID();
      const { data, error } = await supabase.from('import_jobs').insert({
        id,
        workspace_id: workspaceId,
        file_name: String(body.fileName || 'csv_upload.csv').slice(0, 240),
        status: 'uploading',
        total_rows: Math.max(0, Number(body.totalRows || 0)),
        valid_rows: Math.max(0, Number(body.validRows || 0)),
        email_rows: Math.max(0, Number(body.emailRows || 0)),
        no_email_rows: Math.max(0, Number(body.noEmailRows || 0)),
        invalid_rows: Math.max(0, Number(body.invalidRows || 0)),
        duplicate_rows: Math.max(0, Number(body.fileDuplicateRows || 0)),
        category_id: body.categoryId || null,
        category_name: String(body.categoryName || '').trim() || null,
        headers: Array.isArray(body.headers) ? body.headers : [],
        enqueue_research: Boolean(body.enqueueResearch),
        created_by: access.user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select('*').single();
      if (error) throw error;
      return NextResponse.json({ success: true, job: data });
    }

    const jobId = String(body.jobId || body.job_id || '').trim();
    if (!jobId) throw new Error('jobId is required.');
    const { data: job, error: jobError } = await supabase.from('import_jobs').select('*').eq('id', jobId).eq('workspace_id', workspaceId).single();
    if (jobError || !job) throw new Error(jobError?.message || 'Import job not found.');

    if (action === 'upload_rows') {
      if (!['uploading', 'failed'].includes(String(job.status))) throw new Error(`Rows cannot be staged while job is ${job.status}.`);
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1500) : [];
      if (!rows.length) return NextResponse.json({ success: true, staged: 0 });
      const allowedStatuses = new Set(['pending', 'invalid', 'file_duplicate']);
      const payload = rows.map((row: any) => ({
        job_id: jobId,
        row_no: Number(row.row_no),
        dedupe_key: String(row.dedupe_key || '').slice(0, 1000),
        row_data: row.row_data || {},
        status: allowedStatuses.has(String(row.status || 'pending')) ? String(row.status || 'pending') : 'pending',
      })).filter((row: any) => Number.isInteger(row.row_no) && row.row_no >= 0 && row.dedupe_key);
      const { error } = await supabase.from('import_job_rows').upsert(payload, { onConflict: 'job_id,row_no' });
      if (error) throw error;
      await supabase.from('import_jobs').update({ status: 'uploading', last_progress_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', jobId);
      return NextResponse.json({ success: true, staged: payload.length });
    }

    if (action === 'finish_upload') {
      const [{ count: pendingCount }, { count: stagedCount }] = await Promise.all([
        supabase.from('import_job_rows').select('row_no', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'pending'),
        supabase.from('import_job_rows').select('row_no', { count: 'exact', head: true }).eq('job_id', jobId),
      ]);
      if (Number(pendingCount || 0) < Number(job.valid_rows || 0)) throw new Error(`Only ${Number(pendingCount || 0).toLocaleString()} of ${Number(job.valid_rows || 0).toLocaleString()} valid rows were staged.`);
      const { data, error } = await supabase.from('import_jobs').update({ status: 'queued', staged_rows: Number(stagedCount || 0), last_progress_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq('id', jobId).select('*').single();
      if (error) throw error;
      return NextResponse.json({ success: true, job: data });
    }

    if (action === 'pause' || action === 'resume' || action === 'cancel') {
      const next = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : 'cancelled';
      const { data, error } = await supabase.from('import_jobs').update({ status: next, error_message: null, updated_at: new Date().toISOString() }).eq('id', jobId).select('*').single();
      if (error) throw error;
      return NextResponse.json({ success: true, job: data });
    }

    throw new Error('Unknown import job action.');
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 400 });
  }
}
