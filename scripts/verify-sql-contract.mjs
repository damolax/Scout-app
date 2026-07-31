import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files={
 patch:path.join(root,'RUN_THIS_V10_42_6_SENDING_STABILITY_IN_CURRENT_SUPABASE.sql'),
 combined:path.join(root,'RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql'),
 current:path.join(root,'RUN_THIS_V10_42_UPGRADE_IN_CURRENT_SUPABASE.sql'),
 fresh:path.join(root,'database','01_FRESH_INSTALL_V10_42.sql'),
 verify:path.join(root,'VERIFY_SCOUT_V10_42_6.sql'),
 cron:path.join(root,'database','04_SET_VAULT_AND_CRON.sql.template'),
};
for(const [name,file] of Object.entries(files)){if(!fs.existsSync(file)){console.error(`Missing ${name}: ${file}`);process.exit(1);}}
const read=(f)=>fs.readFileSync(f,'utf8').toLowerCase();
const required=['10.42.6','sent_messages_followup_due_v10426_idx','reply_history_followup_due_v10426_idx','message_schedules_global_stale_v10426_idx','get_due_followups','count_due_followups','timeout_milliseconds := 55000','configure_scout_message_worker'];
let failures=0;
for(const name of ['patch','combined','current','fresh']){const text=read(files[name]);const missing=required.filter(t=>!text.includes(t));if(missing.length){failures+=missing.length;console.error(`${name} SQL missing: ${missing.join(', ')}`)}else console.log(`${name} SQL contract: PASS`);}
const verify=read(files.verify);for(const token of ['schema:10.42.6','worker:configured','followup:preview-smoke-test']){if(!verify.includes(token)){failures++;console.error(`verify SQL missing: ${token}`)}}
const patch=fs.readFileSync(files.patch,'utf8');
if((patch.match(/\$fn\$/g)||[]).length%2!==0){failures++;console.error('Unbalanced $fn$ delimiter.');}
if((patch.match(/\$do\$/g)||[]).length%2!==0){failures++;console.error('Unbalanced $do$ delimiter.');}
if(failures) process.exit(1);
console.log('Scout v10.42.6 SQL contracts passed.');
