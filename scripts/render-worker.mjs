#!/usr/bin/env node
/*
  Scout Render Worker
  Runs Scout background automation outside the browser so jobs continue after users leave the app.

  Required environment variables:
    SCOUT_APP_URL=https://your-vercel-app.vercel.app
    SCOUT_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
    RUN_ALL_WORKER_SECRET=your-secret

  Optional:
    WORKER_INTERVAL_MINUTES=15
    RUN_ONCE=true
    WORKER_REPLY_LIMIT=500
    WORKER_REPLY_DAYS=90
    WORKER_SCHEDULE_LIMIT=3
    WORKER_AUTO_SCOUT_CYCLES=5
    WORKER_AUTO_SCOUT_BATCH_SIZE=100
    WORKER_AUTO_SCOUT_CONCURRENCY=12
    WORKER_AUTO_SCOUT_ENQUEUE_LIMIT=2500
*/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function numberEnv(name, fallback, min, max) {
  const parsed = Number(env(name, String(fallback)));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function boolEnv(name, fallback = false) {
  const value = env(name, fallback ? 'true' : 'false').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(value);
}

function requireEnv(name) {
  const value = env(name, '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const appUrl = requireEnv('SCOUT_APP_URL').replace(/\/+$/, '');
const workspaceId = requireEnv('SCOUT_WORKSPACE_ID');
const secret = requireEnv('RUN_ALL_WORKER_SECRET');
const intervalMinutes = numberEnv('WORKER_INTERVAL_MINUTES', 15, 1, 1440);
const runOnce = boolEnv('RUN_ONCE', false);

const workerOptions = {
  workspaceId,
  includeReplies: true,
  includeBounces: true,
  includeSchedules: true,
  includeAutoScout: true,
  includeSeedTest: boolEnv('WORKER_INCLUDE_SEED_TEST', false),
  includeRepairReady: true,
  replyDays: numberEnv('WORKER_REPLY_DAYS', 90, 1, 90),
  replyLimit: numberEnv('WORKER_REPLY_LIMIT', 500, 1, 500),
  scheduleLimit: numberEnv('WORKER_SCHEDULE_LIMIT', 3, 1, 3),
  autoScoutCycles: numberEnv('WORKER_AUTO_SCOUT_CYCLES', 5, 1, 25),
  autoScoutBatchSize: numberEnv('WORKER_AUTO_SCOUT_BATCH_SIZE', 100, 1, 500),
  autoScoutConcurrency: numberEnv('WORKER_AUTO_SCOUT_CONCURRENCY', 12, 1, 50),
  autoScoutEnqueueLimit: numberEnv('WORKER_AUTO_SCOUT_ENQUEUE_LIMIT', 2500, 0, 50000),
  token: secret
};

function buildUrl() {
  const url = new URL('/api/workers/run-all', appUrl);
  url.searchParams.set('workspaceId', workspaceId);
  url.searchParams.set('includeSeedTest', String(workerOptions.includeSeedTest));
  url.searchParams.set('replyDays', String(workerOptions.replyDays));
  url.searchParams.set('replyLimit', String(workerOptions.replyLimit));
  url.searchParams.set('scheduleLimit', String(workerOptions.scheduleLimit));
  url.searchParams.set('autoScoutCycles', String(workerOptions.autoScoutCycles));
  url.searchParams.set('autoScoutBatchSize', String(workerOptions.autoScoutBatchSize));
  url.searchParams.set('autoScoutConcurrency', String(workerOptions.autoScoutConcurrency));
  url.searchParams.set('autoScoutEnqueueLimit', String(workerOptions.autoScoutEnqueueLimit));
  return url;
}

async function runCycle() {
  const startedAt = new Date().toISOString();
  const url = buildUrl();
  console.log(`[Scout Render Worker] ${startedAt} starting run-all for workspace ${workspaceId}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${secret}`,
      'x-run-all-worker-secret': secret,
      'x-cron-secret': secret
    },
    body: JSON.stringify(workerOptions)
  });

  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!response.ok && response.status !== 207) {
    const message = json?.error || json?.raw || `HTTP ${response.status}`;
    throw new Error(`run-all failed: ${message}`);
  }

  const finishedAt = new Date().toISOString();
  const failed = Number(json?.failed || 0);
  const completed = Number(json?.completed || 0);
  const skipped = Number(json?.skipped || 0);
  console.log(`[Scout Render Worker] ${finishedAt} completed=${completed} skipped=${skipped} failed=${failed}`);
  if (Array.isArray(json?.steps)) {
    for (const step of json.steps) {
      console.log(`  - ${step.key}: ${step.status}${step.error ? ` (${step.error})` : ''}`);
    }
  }
  return json;
}

async function main() {
  console.log('[Scout Render Worker] booting');
  console.log(`[Scout Render Worker] app=${appUrl} interval=${intervalMinutes}m runOnce=${runOnce}`);

  while (true) {
    try {
      await runCycle();
    } catch (error) {
      console.error(`[Scout Render Worker] ${new Date().toISOString()} ERROR`, error instanceof Error ? error.stack || error.message : error);
    }

    if (runOnce) break;
    await sleep(intervalMinutes * 60 * 1000);
  }
}

main().catch((error) => {
  console.error('[Scout Render Worker] fatal error', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
