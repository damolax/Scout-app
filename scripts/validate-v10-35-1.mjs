import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const failures = [];
const passes = [];
function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const pkg = JSON.parse(read('package.json'));
const lock = read('package-lock.json');
const sql = read('RUN_THIS_SQL_FIRST_V10_35_1_SCALE_GUARD.sql');
const schedules = read('app/api/message/run-schedules/route.ts');
const directSend = read('app/api/gmail/send/route.ts');
const accountsApi = read('app/api/gmail/accounts/route.ts');
const settings = read('app/(app)/settings/SettingsClient.tsx');
const deliverability = read('app/(app)/deliverability/page.tsx');
const appRunner = read('components/AppOpenRunner.tsx');
const worker = read('scripts/scale-guard-worker.mjs');
const vercel = JSON.parse(read('vercel.json'));
const env = read('.env.example');
const oauth = read('app/api/gmail/oauth/start/route.ts');
const flags = read('lib/feature-flags.ts');
const messagePage = read('app/(app)/message/MessageClient.tsx');
const team = read('app/(app)/team/TeamClient.tsx');

check('Package version is 10.35.1', pkg.version === '10.35.1');
check('Node 22 through 24 supported', pkg.engines?.node === '>=22 <25');
check('Public npm registry only in lockfile', !/applied-caas|internal\.api\.openai/i.test(lock) && lock.includes('https://registry.npmjs.org/'));
check('Scale Guard validator is registered', pkg.scripts?.['validate:v10.35.1'] === 'node scripts/validate-v10-35-1.mjs');
check('Central worker script is registered', pkg.scripts?.['worker:scale-guard'] === 'node scripts/scale-guard-worker.mjs');
check('No unsupported frequent Vercel cron is shipped', !('crons' in vercel));
check('Vercel uses public npm registry and reproducible npm ci', String(vercel.installCommand || '').includes('registry.npmjs.org') && String(vercel.installCommand || '').includes('npm ci'));
check('Central worker requires app URL and secret', worker.includes('SCOUT_APP_URL') && worker.includes('SCHEDULE_WORKER_SECRET'));
check('Central worker has timeout and exponential backoff', worker.includes('AbortController') && worker.includes('2 ** Math.min'));
check('Browser schedule runner is disabled', appRunner.includes('return null') && !appRunner.includes('setInterval'));
check('Message page no longer starts due schedules from every browser', messagePage.includes('scheduled jobs are claimed by the central worker') && !messagePage.includes('autoRunDueSchedules'));
check('Global campaign leases are enforced', schedules.includes('acquireCampaignLease') && schedules.includes('MAX_ACTIVE_CAMPAIGNS'));
check('Global sender-lane leases are enforced', schedules.includes('acquireSenderLaneLease') && schedules.includes('MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE'));
check('Direct one-off sends also use shared sender lanes', directSend.includes('acquireDirectSenderLane') && directSend.includes('releaseDirectSenderLane'));
check('Duplicate campaign lease is refused', sql.includes('Campaign is already active in another worker.') && !sql.includes("select true, l.lease_token, l.slot, 'Campaign lease already held.'"));
check('Campaign and sender lease RPCs are service-role only', sql.includes('grant execute on function public.acquire_scout_campaign_lease') && sql.includes('to service_role') && sql.includes('grant execute on function public.acquire_scout_sender_lane'));
check('Sender account list is server-paginated', accountsApi.includes('scout_sender_accounts_page') && settings.includes("pageSize: '25'"));
check('Sender page supports search and health filter', settings.includes('Search connected Gmail') && settings.includes('All senders') && sql.includes('p_search text') && sql.includes('p_filter text'));
check('Raw token entry is hidden by default behind a development flag', settings.includes('MANUAL_GMAIL_TOKEN_ENTRY_ENABLED') && env.includes('NEXT_PUBLIC_MANUAL_GMAIL_TOKEN_ENTRY_ENABLED=false'));
check('Safe Gmail API never selects raw account rows', !accountsApi.includes("select('*')") && !accountsApi.includes('access_token') && !accountsApi.includes('refresh_token'));
check('Settings no longer performs per-sender history counts', !settings.includes("from('sent_messages').select('id', { count: 'exact', head: true })"));
check('Lifetime sender summary table exists', sql.includes('scout_sender_lifetime_stats') && sql.includes('sent_messages_scout_lifetime_stats_insert'));
check('Lifetime backfill skips deleted or mismatched Gmail accounts', sql.includes('join public.gmail_accounts ga') && sql.includes('skipped % historical sent-message rows') && sql.includes('ga.workspace_id = sm.workspace_id'));
check('Lifetime trigger guards active Gmail account relation', sql.includes('and exists (') && sql.includes('ga.id = new.gmail_account_id') && sql.includes('ga.workspace_id = new.workspace_id'));
check('Deliverability page uses grouped summary RPC', deliverability.includes('scout_deliverability_sender_summary') && !deliverability.includes('.limit(5000)'));
check('Scheduled progress writes are batched', schedules.includes('currentCount - lastProgressWriteCount < 10'));
check('Empty pacing passes do not create outreach batches', schedules.indexOf('if (!passCandidateAccounts.length)') < schedules.indexOf('const ensureBatchCreated'));
check('Batch creation is serialized across sender lanes', schedules.includes('batchCreatePromise'));
check('Worker rotates through all due connected accounts', schedules.includes('const passCandidateAccounts = laneAccounts.filter') && !schedules.includes('laneAccounts.slice(\n      0,\n      Math.max(MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE * 10'));
check('Stale campaign reset exceeds lease duration', schedules.includes('Date.now() - 18 * 60 * 1000'));
check('Schedule query is fair and oldest-updated first', schedules.includes('.order("updated_at", { ascending: true })'));
check('OAuth remains send-only', oauth.includes('https://www.googleapis.com/auth/gmail.send') && !/gmail\.(readonly|settings\.basic|modify|metadata)|https:\/\/mail\.google\.com\//.test(oauth));
check('Reply sync remains coded but disabled by default', flags.includes("gmailReplySync: enabled('GMAIL_REPLY_SYNC_ENABLED', false)"));
check('Native signature sync remains coded but disabled by default', flags.includes("gmailNativeSignatureSync: enabled('GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED', false)"));
check('Central worker capacity defaults are documented', ['SCOUT_MAX_ACTIVE_CAMPAIGNS=12','SCOUT_MAX_ACTIVE_CAMPAIGNS_PER_WORKSPACE=1','SCOUT_MAX_ACTIVE_SENDER_LANES=12','SCOUT_MAX_ACTIVE_SENDER_LANES_PER_WORKSPACE=2'].every((value) => env.includes(value)));
check('Worker polling is not browser-dependent', env.includes('NEXT_PUBLIC_CENTRAL_WORKER_ENABLED=true') && env.includes('SCOUT_WORKER_INTERVAL_MS=10000'));
check('Team page retains server pagination', team.includes('PAGE_SIZE = 20') && team.includes('admin_team_dashboard_page'));
check('Live seed-test schema compatibility is repaired', sql.includes('sync_seed_inbox_test_compatibility') && sql.includes('add column if not exists sender_gmail_account_id') && sql.includes('add column if not exists gmail_account_id'));
check('Missing sender profile field is added safely', sql.includes('add column if not exists profile_picture_url text'));
check('Scale migration is additive', !/\bdrop\s+(table|schema|column)\b/i.test(sql));
check('Scale migration does not rewrite workspace roles', !/update\s+public\.workspace_members/i.test(sql) && !/delete\s+from\s+public\.workspace_members/i.test(sql));
check('Required public verification pages remain', ['app/privacy/page.tsx','app/terms/page.tsx','app/data-deletion/page.tsx','app/contact/page.tsx','app/google-data-use/page.tsx'].every(exists));

console.log(`Scout v10.35.1 Scale Guard validation: ${passes.length} passed`);
for (const name of passes) console.log(`  PASS  ${name}`);
if (failures.length) {
  console.error(`\n${failures.length} validation failure(s):`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
