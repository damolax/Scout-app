import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files={
 current:path.join(root,'RUN_THIS_V10_42_UPGRADE_IN_CURRENT_SUPABASE.sql'),
 combined:path.join(root,'RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql'),
 fresh:path.join(root,'database','01_FRESH_INSTALL_V10_42.sql'),
 verify:path.join(root,'database','10_VERIFY_V10_42.sql'),
 hotfix:path.join(root,'database','11_V10_42_1_FAST_IMPORT_RUN_DEFAULT.sql'),
 pendingDelete:path.join(root,'database','12_V10_42_2_PENDING_DELETE_UNLOCK.sql'),
 readyDetection:path.join(root,'database','10_V10_42_4_READY_DETECTION_PERFORMANCE.sql'),
 readiness:path.join(root,'RUN_THIS_V10_42_5_READINESS_STABILITY_FIX_IN_CURRENT_SUPABASE.sql'),
 cron:path.join(root,'database','04_SET_VAULT_AND_CRON.sql.template'),
};
for(const [name,file] of Object.entries(files)){if(!fs.existsSync(file)){console.error(`Missing ${name}: ${file}`);process.exit(1);}}
const read=(f)=>fs.readFileSync(f,'utf8').toLowerCase();
const groups=[
 ['current',read(files.current),[
  'create table if not exists public.import_jobs','create table if not exists public.import_job_rows',
  'create table if not exists public.lead_dedupe_registry','process_import_job_batch_v1042',
  'health_recommended_limit','owner_override_locked','sender_health_daily','sender_limit_audit',
  'scouting_xp_state','scouting_xp_events','award_scouting_xp_v1042',
  'team_registry as','research_jobs as','research_rows=research_rows+research_count',
  'create or replace function public.reserve_sender_send',"'10.42.0'"
 ]],
 ['combined',read(files.combined),['begin scout v10.42.0 upgrade','process_import_job_batch_v1042',"'10.42.0'"]],
 ['fresh',read(files.fresh),['scout v10.36 fresh installation','begin scout v10.42.0 features','process_import_job_batch_v1042',"'10.42.0'"]],
 ['verify',read(files.verify),['import_jobs','import_businesses_bulk_v2','sender-default-run:100','schema:10.42.2']],
 ['hotfix',read(files.hotfix),['alter column default_run_limit set default 100',"'10.42.1'",'90-210 seconds','3-6 seconds']],
 ['pending-delete',read(files.pendingDelete),['delete_pending_no_email_businesses',"'10.42.2'",'scout_v10422_status','delete_rpc_ready']],
 ['ready-detection',read(files.readyDetection),['ready_email_detection_stats_v10424','ready_email_detection_page_v10424','run_ready_email_detection_v10424','businesses_ready_detection_queue_v10424_idx',"'10.42.4'"]],
 ['readiness',read(files.readiness),['scout_readiness_probe_v10425','scout_message_worker_ping_v10425','businesses_contactable_readiness_v10425_idx','message_schedules_worker_ping_v10425_idx',"'10.42.5'"]],
 ['cron',read(files.cron),['/api/cron/import-worker','scout-import-worker-v1042','/api/cron/health-review','/api/message/run-schedules']],
];
let failures=0;
for(const [name,text,tokens] of groups){const missing=tokens.filter(t=>!text.includes(t));if(missing.length){failures+=missing.length;console.error(`${name} contract missing:`);missing.forEach(t=>console.error(`- ${t}`));}else console.log(`${name} SQL contract: PASS (${tokens.length} markers)`);}
const focused=fs.readFileSync(files.current,'utf8');
const dollarPairs=(focused.match(/\$\$/g)||[]).length;
if(dollarPairs%2!==0){failures++;console.error('current SQL has an unbalanced $$ delimiter count.');}
if(/create or replace function public\.reserve_sender_send\(\s*create or replace function/i.test(focused)){failures++;console.error('current SQL contains a duplicated reserve_sender_send declaration.');}
if((focused.match(/create or replace function public\.reserve_sender_send\(/gi)||[]).length!==1){failures++;console.error('current SQL must define reserve_sender_send exactly once.');}
if(failures) process.exit(1);
console.log('Scout v10.42.5 SQL contracts passed.');
