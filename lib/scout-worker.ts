import { createAdminClient } from '@/lib/supabase-admin';
import { workerSecret } from '@/lib/message-worker';

function normalizeAppUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export async function ensureUnifiedScoutWorker(origin: string) {
  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL || origin);
  const secret = workerSecret();
  if (!appUrl) return { ready: false, error: 'NEXT_PUBLIC_APP_URL is missing.' };
  if (secret.length < 24) return { ready: false, error: 'SCHEDULE_WORKER_SECRET/CRON_SECRET must be at least 24 characters.' };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('configure_unified_scout_worker', {
      target_app_url: appUrl,
      target_worker_secret: secret,
      target_seconds: 60,
    });
    if (error) return { ready: false, error: error.message };
    const result = Array.isArray(data) ? data[0] : data;
    return { ready: Boolean(result?.ready ?? true), ...result };
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}
