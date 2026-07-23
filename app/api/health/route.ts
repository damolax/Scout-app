import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkScoutSchema } from '@/lib/schema-readiness';

export const dynamic = 'force-dynamic';

function has(name: string) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

export async function GET() {
  const defaultWorkspaceId = process.env.SCOUT_DEFAULT_WORKSPACE_ID || '00000000-0000-4000-8000-000000000001';
  const env = {
    supabaseUrl: has('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnon: has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabaseServerSecret: has('SUPABASE_SECRET_KEY') || has('SUPABASE_SERVICE_ROLE_KEY'),
    googleClientId: has('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || has('GOOGLE_CLIENT_ID'),
    googleClientSecret: has('GOOGLE_CLIENT_SECRET'),
    workerSecretsMatch:
      has('SCHEDULE_WORKER_SECRET') &&
      has('CRON_SECRET') &&
      process.env.SCHEDULE_WORKER_SECRET === process.env.CRON_SECRET,
  };

  let centralWorker: Record<string, unknown> = {
    ready: false,
    active: false,
    error: 'Worker status has not been checked.',
  };
  let schema: Awaited<ReturnType<typeof checkScoutSchema>> | null = null;
  let bulkImportReady = false;
  let databaseError = '';

  try {
    const supabase = createAdminClient();
    const [workerResult, schemaResult, bulkImportResult] = await Promise.all([
      supabase.rpc('scout_message_worker_status'),
      checkScoutSchema(supabase, defaultWorkspaceId),
      supabase.from('scout_schema_versions').select('version').eq('version', '10.41.0').maybeSingle()
    ]);
    if (workerResult.error) throw workerResult.error;
    centralWorker = (Array.isArray(workerResult.data) ? workerResult.data[0] : workerResult.data) || centralWorker;
    schema = schemaResult;
    bulkImportReady = !bulkImportResult.error && bulkImportResult.data?.version === '10.41.0';
  } catch (error) {
    databaseError = error instanceof Error ? error.message : String(error);
    centralWorker = {
      ready: false,
      active: false,
      error: databaseError,
    };
  }

  const environmentReady = Object.values(env).every(Boolean);
  const schemaReady = Boolean(schema?.ready);
  const workerReady = centralWorker.ready === true;
  const ready = environmentReady && schemaReady && workerReady;

  const payload = {
    success: ready,
    ready,
    app: 'ok',
    version: '10.41.0',
    build: 'high-speed-resumable-bulk-import',
    bulkImportContract: '10.41.0',
    bulkImportReady,
    environmentReady,
    schemaReady,
    workerReady,
    env,
    schema,
    centralWorker,
    databaseError: databaseError || null,
    defaultWorkspaceId,
  };

  return NextResponse.json(payload, { status: ready ? 200 : 503 });
}
