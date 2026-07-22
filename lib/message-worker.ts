import { createAdminClient } from '@/lib/supabase-admin';

export type MessageWorkerSetup = {
  ready: boolean;
  configured: boolean;
  jobName?: string;
  schedule?: string;
  appUrl?: string;
  error?: string;
};

function normalizeAppUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function workerSecret() {
  return String(
    process.env.SCHEDULE_WORKER_SECRET ||
      process.env.CRON_SECRET ||
      process.env.RUN_ALL_WORKER_SECRET ||
      '',
  ).trim();
}

export async function ensureMessageWorker(origin: string): Promise<MessageWorkerSetup> {
  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL || origin);
  const secret = workerSecret();
  if (!appUrl) {
    return { ready: false, configured: false, error: 'NEXT_PUBLIC_APP_URL is missing.' };
  }
  if (secret.length < 24) {
    return {
      ready: false,
      configured: false,
      appUrl,
      error: 'SCHEDULE_WORKER_SECRET and CRON_SECRET must contain the same long secret.',
    };
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('configure_scout_message_worker', {
      target_app_url: appUrl,
      target_worker_secret: secret,
      target_seconds: 15,
    });
    if (error) {
      return {
        ready: false,
        configured: false,
        appUrl,
        error: `Central worker setup failed: ${error.message}. Run RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql once, then use Settings → Run full check.`,
      };
    }
    const result = Array.isArray(data) ? data[0] : data;
    return {
      ready: Boolean(result?.ready ?? true),
      configured: true,
      jobName: String(result?.job_name || 'scout-message-worker-every-15-seconds'),
      schedule: String(result?.schedule || '15 seconds'),
      appUrl,
    };
  } catch (error) {
    return {
      ready: false,
      configured: false,
      appUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
