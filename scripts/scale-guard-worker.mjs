/**
 * Scout v10.35.1 central worker.
 * Run this as a single Render Background Worker (or equivalent always-on process).
 * It claims due jobs through the secured Scout API. Database leases guarantee that
 * accidental duplicate worker processes do not duplicate campaigns or sender lanes.
 */

const appUrl = String(process.env.SCOUT_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
  .trim()
  .replace(/\/+$/, "");
const secret = String(process.env.SCHEDULE_WORKER_SECRET || "").trim();
const baseIntervalMs = Math.max(5_000, Math.min(60_000, Number(process.env.SCOUT_WORKER_INTERVAL_MS || 10_000)));
const maxBackoffMs = Math.max(baseIntervalMs, Math.min(300_000, Number(process.env.SCOUT_WORKER_MAX_BACKOFF_MS || 60_000)));
const limit = Math.max(1, Math.min(12, Number(process.env.SCOUT_WORKER_CAMPAIGNS_PER_TICK || 6)));

if (!appUrl) {
  console.error("SCOUT_APP_URL is required, for example https://scout.example.com");
  process.exit(1);
}
if (!secret) {
  console.error("SCHEDULE_WORKER_SECRET is required and must match the Vercel environment variable.");
  process.exit(1);
}

const endpoint = `${appUrl}/api/message/run-schedules`;
let stopped = false;
let failures = 0;

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 285_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${secret}`,
        "x-schedule-worker-secret": secret,
      },
      body: JSON.stringify({
        limit,
        source: "scale_guard_worker",
        token: secret,
        drainForMs: 260_000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || `Worker endpoint returned HTTP ${response.status}`);
    }
    failures = 0;
    const ran = Number(payload?.ran || 0);
    if (ran > 0) {
      console.log(`[${new Date().toISOString()}] Processed ${ran} campaign pass(es).`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

console.log(`Scout Scale Guard worker started. Endpoint: ${endpoint}; interval: ${baseIntervalMs}ms.`);
while (!stopped) {
  try {
    await tick();
  } catch (error) {
    failures += 1;
    console.error(`[${new Date().toISOString()}] Worker tick failed:`, error instanceof Error ? error.message : String(error));
  }
  const backoff = failures
    ? Math.min(maxBackoffMs, baseIntervalMs * (2 ** Math.min(5, failures)))
    : baseIntervalMs;
  await wait(backoff);
}
console.log("Scout Scale Guard worker stopped cleanly.");
