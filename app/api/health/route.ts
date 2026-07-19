import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function has(name: string) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

export async function GET() {
  let centralWorker: Record<string, unknown> = {
    ready: false,
    active: false,
    error: 'Worker status has not been checked.',
  };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('scout_message_worker_status');
    if (error) throw error;
    centralWorker = (Array.isArray(data) ? data[0] : data) || centralWorker;
  } catch (error) {
    centralWorker = {
      ready: false,
      active: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const checks = {
    success: true,
    app: 'ok',
    version: '10.38.5',
    supabaseUrl: has('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseAnon: has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabaseServerSecret: has('SUPABASE_SECRET_KEY') || has('SUPABASE_SERVICE_ROLE_KEY'),
    googleClientId: has('NEXT_PUBLIC_GOOGLE_CLIENT_ID') || has('GOOGLE_CLIENT_ID'),
    googleClientSecret: has('GOOGLE_CLIENT_SECRET'),
    workerSecretsMatch:
      has('SCHEDULE_WORKER_SECRET') &&
      has('CRON_SECRET') &&
      process.env.SCHEDULE_WORKER_SECRET === process.env.CRON_SECRET,
    centralWorker,
    defaultWorkspaceId: process.env.SCOUT_DEFAULT_WORKSPACE_ID || '00000000-0000-4000-8000-000000000001',
  };

  return NextResponse.json(checks);
}
