import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  upgrade: path.join(root, 'RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql'),
  fresh: path.join(root, 'database', '01_FRESH_INSTALL_V10_40.sql'),
  verify: path.join(root, 'database', '03_VERIFY_V10_40.sql'),
  cron: path.join(root, 'database', '04_SET_VAULT_AND_CRON.sql.template'),
};
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    console.error(`SQL contract check failed: ${name} file is missing: ${file}`);
    process.exit(1);
  }
}
const upgrade = fs.readFileSync(files.upgrade, 'utf8').toLowerCase();
const fresh = fs.readFileSync(files.fresh, 'utf8').toLowerCase();
const verify = fs.readFileSync(files.verify, 'utf8').toLowerCase();
const cron = fs.readFileSync(files.cron, 'utf8').toLowerCase();
const requiredUpgrade = [
  'create function public.get_due_followups',
  'create function public.count_due_followups',
  'create or replace function public.scout_message_worker_status',
  'add column if not exists granted_scopes',
  'add column if not exists oauth_reconnect_required',
  'add column if not exists last_reply_sync_at',
  'add column if not exists gmail_signature_synced_at',
  'add column if not exists email_signature_text',
  'add column if not exists email_signature_html',
  'add column if not exists email_logo_url',
  'reply_history_workspace_gmail_message_uidx',
  'no_inbox_workspace_gmail_message_uidx',
  "'10.40.0'",
  "'10.40.0'::text as deployed_schema_contract",
  "'ready'::text as scout_database_status",
];
const requiredFresh = [
  'scout v10.36 fresh installation',
  'create table if not exists public.workspaces',
  'create table if not exists public.gmail_accounts',
  'create table if not exists public.businesses',
  'create table if not exists public.sent_messages',
  'create table if not exists public.reply_history',
  "'10.40.0'",
];
const requiredVerify = ['runtime_required_columns', 'reply_dedup_index', 'followup_queue_rpc', "version='10.40.0'"];
const requiredCron = ['/api/cron/inbound-sync', '/api/message/run-schedules', '/api/cron/research-worker', '/api/cron/health-review'];
const groups = [
  ['upgrade', upgrade, requiredUpgrade],
  ['fresh', fresh, requiredFresh],
  ['verify', verify, requiredVerify],
  ['cron', cron, requiredCron],
];
let failures = 0;
for (const [name, text, tokens] of groups) {
  const missing = tokens.filter((token) => !text.includes(token));
  if (missing.length) {
    failures += missing.length;
    console.error(`${name} contract missing:`);
    missing.forEach((token) => console.error(`- ${token}`));
  } else {
    console.log(`${name} SQL contract: PASS (${tokens.length} markers)`);
  }
}
if (failures) process.exit(1);
console.log('Scout v10.40.0 SQL contracts passed.');
