import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkScoutSchema, SCOUT_SCHEMA_CONTRACT_VERSION } from '@/lib/schema-readiness';
import { getCurrentWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

function has(name: string) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function compactError(error: unknown) {
  if (error instanceof Error) return error.message;
  const value = error as { message?: string; code?: string; details?: string } | null;
  return [value?.message, value?.code ? `Code ${value.code}` : '', value?.details]
    .filter(Boolean)
    .join(' | ') || String(error || 'Temporary health-check error.');
}

function normalizeObject(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') === '1';
  const defaultWorkspaceId = process.env.SCOUT_DEFAULT_WORKSPACE_ID || '00000000-0000-4000-8000-000000000001';
  let workspaceId = defaultWorkspaceId;

  if (deep) {
    const current = await getCurrentWorkspace();
    if (!current.workspace) {
      return NextResponse.json({ success: false, ready: false, error: current.error || 'Not signed in.' }, { status: 401 });
    }
    const requestedWorkspace = url.searchParams.get('workspaceId');
    if (requestedWorkspace && requestedWorkspace !== current.workspace.id) {
      return NextResponse.json({ success: false, ready: false, error: 'Workspace access was not confirmed.' }, { status: 403 });
    }
    workspaceId = current.workspace.id;
  }

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

  const environmentReady = Object.values(env).every(Boolean);
  let schema: Awaited<ReturnType<typeof checkScoutSchema>> | null = null;
  let workerProbe: Record<string, unknown> | null = null;
  let databaseError: string | null = null;

  try {
    const supabase = createAdminClient();
    schema = await checkScoutSchema(supabase, workspaceId);
    if (deep) {
      const { data, error } = await supabase.rpc('scout_message_worker_ping_v10425', {
        target_workspace: workspaceId
      });
      if (error) {
        workerProbe = { state: 'degraded', error: compactError(error) };
      } else {
        workerProbe = normalizeObject(data);
      }
    }
  } catch (error) {
    databaseError = compactError(error);
  }

  const requiredFunctions = schema?.probe?.requiredFunctions || {};
  const bulkImportReady = requiredFunctions.import_businesses_bulk_v2 === true;
  const schemaReady = Boolean(schema?.ready && !schema.confirmedMissing);
  const confirmedMissing = Boolean(schema?.confirmedMissing);
  const workerConfigured = env.workerSecretsMatch;
  const workerState = String(workerProbe?.state || (workerConfigured ? 'good' : 'missing'));
  const workerReady = workerConfigured && (!deep || workerState !== 'missing');
  const degraded = Boolean(databaseError || schema?.degraded?.length || workerState === 'degraded');
  const ready = environmentReady && schemaReady && workerReady && !confirmedMissing;

  const payload = {
    success: ready,
    ready,
    app: 'ok',
    version: '10.42.5',
    build: 'readiness-timeout-classification-page-recovery-fix',
    requiredSchemaVersion: SCOUT_SCHEMA_CONTRACT_VERSION,
    bulkImportContract: SCOUT_SCHEMA_CONTRACT_VERSION,
    senderHealthContract: SCOUT_SCHEMA_CONTRACT_VERSION,
    scoutingXpContract: SCOUT_SCHEMA_CONTRACT_VERSION,
    bulkImportReady,
    environmentReady,
    schemaReady,
    confirmedMissing,
    degraded,
    workerConfigured,
    workerReady,
    env,
    schema,
    workerProbe,
    databaseError,
    defaultWorkspaceId,
  };

  const blockingFailure = !environmentReady || confirmedMissing || !schema;
  return NextResponse.json(payload, { status: blockingFailure ? 503 : 200 });
}
