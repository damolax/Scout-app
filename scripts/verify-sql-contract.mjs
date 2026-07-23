import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files={
  upgrade:path.join(root,'RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql'),
  fresh:path.join(root,'database','01_FRESH_INSTALL_V10_40.sql'),
  verify:path.join(root,'database','03_VERIFY_V10_40.sql'),
  cron:path.join(root,'database','04_SET_VAULT_AND_CRON.sql.template'),
  bulk:path.join(root,'database','06_HIGH_SPEED_BULK_IMPORT.sql'),
};
for(const [name,file] of Object.entries(files)){
  if(!fs.existsSync(file)){
    console.error(`SQL contract check failed: ${name} file is missing: ${file}`);
    process.exit(1);
  }
}
const read=(file)=>fs.readFileSync(file,'utf8').toLowerCase();
const upgrade=read(files.upgrade);
const fresh=read(files.fresh);
const verify=read(files.verify);
const cron=read(files.cron);
const bulk=read(files.bulk);
const groups=[
  ['upgrade',upgrade,[
    'create function public.get_due_followups',
    'create function public.count_due_followups',
    'create or replace function public.scout_message_worker_status',
    'add column if not exists granted_scopes',
    'add column if not exists email_signature_text',
    "'10.40.0'",
    'create table if not exists public.import_chunk_receipts',
    'create or replace function public.import_businesses_bulk_v2',
    "'10.41.0'",
  ]],
  ['fresh',fresh,[
    'scout v10.36 fresh installation',
    'create table if not exists public.workspaces',
    'create table if not exists public.gmail_accounts',
    'create table if not exists public.businesses',
    'create table if not exists public.import_chunk_receipts',
    'create or replace function public.import_businesses_bulk_v2',
    "'10.41.0'",
  ]],
  ['verify',verify,['runtime_required_columns','reply_dedup_index','followup_queue_rpc',"version='10.40.0'"]],
  ['cron',cron,['/api/cron/inbound-sync','/api/message/run-schedules','/api/cron/research-worker','/api/cron/health-review']],
  ['bulk',bulk,[
    'create table if not exists public.import_chunk_receipts',
    'pg_advisory_xact_lock',
    "set_config('scout.bulk_import', 'on', true)",
    'create or replace function public.import_businesses_bulk_v2',
    'create or replace function public.get_import_batch_progress_v2',
    'create or replace function public.finalize_import_batch_v2',
    "'10.41.0'::text as bulk_import_contract",
  ]],
];
let failures=0;
for(const [name,text,tokens] of groups){
  const missing=tokens.filter(token=>!text.includes(token));
  if(missing.length){
    failures+=missing.length;
    console.error(`${name} contract missing:`);
    missing.forEach(token=>console.error(`- ${token}`));
  } else {
    console.log(`${name} SQL contract: PASS (${tokens.length} markers)`);
  }
}
if(failures) process.exit(1);
console.log('Scout v10.41.0 SQL contracts passed.');
