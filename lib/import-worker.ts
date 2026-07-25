import { createAdminClient } from '@/lib/supabase-admin';
import { awardScoutingXp } from '@/lib/scouting-xp';
import { createAppNotification } from '@/lib/notifications';

type WorkerOptions = {
  jobId?: string | null;
  workspaceId?: string | null;
  maxSeconds?: number;
  batchSize?: number;
  jobLimit?: number;
};

export async function processImportJobs(options: WorkerOptions = {}) {
  const supabase = createAdminClient();
  const started = Date.now();
  const maxMs = Math.max(5_000, Math.min(50_000, Number(options.maxSeconds || 42) * 1000));
  const batchSize = Math.max(25, Math.min(500, Number(options.batchSize || 250)));
  const results: Array<Record<string, unknown>> = [];

  while (Date.now() - started < maxMs) {
    let query = supabase
      .from('import_jobs')
      .select('*')
      .in('status', ['queued', 'processing'])
      .order('last_progress_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(Math.max(1, Math.min(10, Number(options.jobLimit || 3))));
    if (options.jobId) query = query.eq('id', options.jobId);
    if (options.workspaceId) query = query.eq('workspace_id', options.workspaceId);
    const { data: jobs, error } = await query;
    if (error) throw error;
    if (!jobs?.length) break;

    let madeProgress = false;
    for (const job of jobs) {
      if (Date.now() - started >= maxMs) break;
      const requested = Math.max(25, Math.min(batchSize, Number(job.worker_batch_size || batchSize)));
      const rpcStartedAt = Date.now();
      const { data, error: rpcError } = await supabase.rpc('process_import_job_batch_v1042', {
        target_job: job.id,
        requested_batch_size: requested,
      });
      if (rpcError) {
        const message = rpcError.message || String(rpcError);
        const timeout = message.toLowerCase().includes('statement timeout') || String((rpcError as any).code || '') === '57014';
        const reduced = timeout ? Math.max(25, Math.floor(requested / 2)) : requested;
        await supabase.from('import_jobs').update({
          status: timeout ? 'queued' : 'failed',
          worker_batch_size: reduced,
          error_message: message,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        results.push({ jobId: job.id, success: false, timeout, nextBatchSize: reduced, error: message });
        continue;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const elapsedMs = Date.now() - rpcStartedAt;
      const processedNow = Number(row?.processed_now || 0);
      const insertedNow = Number(row?.inserted_now || 0);
      const nextBatchSize = elapsedMs < 1_200 && processedNow >= requested
        ? Math.min(500, requested + 50)
        : elapsedMs > 5_000
          ? Math.max(25, Math.floor(requested * 0.75))
          : requested;
      if (nextBatchSize !== Number(job.worker_batch_size || requested)) {
        await supabase.from('import_jobs').update({ worker_batch_size: nextBatchSize, updated_at: new Date().toISOString() }).eq('id', job.id);
      }
      madeProgress ||= processedNow > 0;
      results.push({ jobId: job.id, success: true, elapsedMs, nextBatchSize, ...row });

      if (insertedNow > 0) {
        await awardScoutingXp(supabase as any, {
          workspaceId: String(job.workspace_id),
          eventType: 'leads_imported',
          points: insertedNow,
          uniqueEventKey: `import-job-batch:${job.id}:${Number(job.processed_rows || 0) + processedNow}`,
          entityType: 'import_job',
          entityId: String(job.id),
          metadata: { insertedNow, processedNow },
        }).catch(() => undefined);
      }

      if (String(row?.job_status || '').startsWith('completed')) {
        await awardScoutingXp(supabase as any, {
          workspaceId: String(job.workspace_id),
          eventType: 'import_completed',
          points: 100,
          uniqueEventKey: `import-completed:${job.id}`,
          entityType: 'import_job',
          entityId: String(job.id),
          metadata: { fileName: job.file_name },
        }).catch(() => undefined);
        const { data: completedJob } = await supabase.from('import_jobs').select('*').eq('id', job.id).maybeSingle();
        await createAppNotification(supabase as any, {
          workspaceId: String(job.workspace_id),
          type: 'import_completed',
          title: `Import completed: ${job.file_name}`,
          message: `${Number(completedJob?.inserted_rows || 0).toLocaleString()} imported · ${Number(completedJob?.duplicate_rows || 0).toLocaleString()} duplicates · ${Number(completedJob?.invalid_rows || 0).toLocaleString()} invalid · ${Number(completedJob?.suppressed_rows || 0).toLocaleString()} suppressed.`,
          entityType: 'import_job',
          entityId: String(job.id),
          raw: completedJob || { jobId: job.id },
        });
      }
    }
    if (!madeProgress || options.jobId) break;
  }

  return { processed: results.length, elapsedMs: Date.now() - started, results };
}
