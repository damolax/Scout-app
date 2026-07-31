import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const get=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
const check=(label,ok,detail='')=>checks.push({label,ok:Boolean(ok),detail});
const pkg=JSON.parse(get('package.json'));
const health=get('app/api/health/route.ts');
const readiness=get('lib/schema-readiness.ts');
const message=get('app/(app)/message/MessageClient.tsx');
const runner=get('components/AppOpenRunner.tsx');
const startJob=get('app/api/message/start-job/route.ts');
const continueJob=get('app/api/message/continue-schedule/route.ts');
const wake=get('app/api/message/wake-schedules/route.ts');
const worker=get('lib/message-worker.ts');
const sql=get('RUN_THIS_V10_42_6_SENDING_STABILITY_IN_CURRENT_SUPABASE.sql');
check('Package version',pkg.version==='10.42.6',pkg.version);
check('Health release marker',health.includes("version: '10.42.6'")&&health.includes('sending-timeout-worker-collision-followup-preview-fix'));
check('Schema contract',readiness.includes("SCOUT_SCHEMA_CONTRACT_VERSION = '10.42.6'"));
check('Deterministic version row',readiness.includes(".eq('version', SCOUT_SCHEMA_CONTRACT_VERSION)")&&readiness.includes(".order('version', { ascending: false })"));
check('Non-blocking start job',startJob.includes("executionMode: 'central_worker'")&&!startJob.includes("fetch(`${origin}/api/message/run-schedules`"));
check('Non-blocking continue job',continueJob.includes("executionMode: 'central_worker'")&&!continueJob.includes('/api/message/run-schedules'));
check('Wake endpoint',wake.includes('ensureMessageWorker')&&wake.includes(".eq('status', 'scheduled')"));
check('Browser runner never executes worker',runner.includes('/api/message/wake-schedules')&&!runner.includes('/api/message/run-schedules'));
check('Worker cadence 30 seconds',worker.includes('target_seconds: 30')&&worker.includes("'30 seconds'"));
check('Worker setup is status-first',worker.includes("rpc('scout_message_worker_status')")&&worker.includes('if (!options?.force)'));
check('Message page wake is not one-second polling',message.includes('const SCHEDULE_RUNNER_INTERVAL_MS = 30_000;'));
check('Follow-up RPCs are sequential',message.includes('Keep the two history-heavy RPCs sequential')&&!message.includes('Promise.allSettled([\n        fetchDueFollowUps(previewLimit),'));
check('Follow-up timeout isolated',message.includes('Queue refresh delayed.')&&message.includes('followUpQueueWarning'));
check('Follow-up preview bounded',message.includes('fetchDueFollowUps(previewLimit)')&&message.includes('previewLimit: 1000'));
check('Send-all exact-count guard',message.includes('Refresh exact count before Send all')&&message.includes('dueFollowUpTotalExact'));
check('Due send uses wake endpoint',message.includes('/api/message/wake-schedules')&&!message.includes('open_app_parallel_sender_runner'));
check('SQL queue indexes',sql.includes('sent_messages_followup_due_v10426_idx')&&sql.includes('reply_history_followup_due_v10426_idx'));
check('SQL worker timeout',sql.includes('timeout_milliseconds := 55000')&&sql.includes("target_seconds integer default 30"));
const countFunctionStart = sql.indexOf('create function public.count_due_followups');
const countFunctionEnd = sql.indexOf('-- The browser now only wakes', countFunctionStart);
const countFunctionSql = countFunctionStart >= 0
  ? sql.slice(countFunctionStart, countFunctionEnd >= 0 ? countFunctionEnd : undefined)
  : '';
check(
  'Optimized count function',
  countFunctionSql.includes('create function public.count_due_followups') &&
    !countFunctionSql.includes('public.get_due_followups('),
);
check('Setup guide',fs.existsSync(path.join(root,'SCOUT_V10_42_6_EXACT_SETUP.html')));
check('Deploy target locked',get('DEPLOY_V10_42_6_FULL_GIT_BASH.sh').includes('damolax/Scout-app.git'));
check('Legacy core preserved',fs.existsSync(path.join(root,'app/api/cron/import-worker/route.ts'))&&fs.existsSync(path.join(root,'app/(app)/verify/VerifyClient.tsx')));
const failures=checks.filter(c=>!c.ok);
for(const c of checks) console.log(`${c.ok?'PASS':'FAIL'}  ${c.label}${c.detail?` — ${c.detail}`:''}`);
console.log(`
${checks.length-failures.length}/${checks.length} static release checks passed.`);
if(failures.length) process.exit(1);
