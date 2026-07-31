-- Scout v10.42.6 read-only verification
select 'schema:10.42.6' as requirement,
       exists(select 1 from public.scout_schema_versions where version='10.42.6') as passed
union all
select 'function:get_due_followups',
       to_regprocedure('public.get_due_followups(uuid,integer,text,integer,integer,uuid,text)') is not null
union all
select 'function:count_due_followups',
       to_regprocedure('public.count_due_followups(uuid,text,integer,integer,uuid,text)') is not null
union all
select 'index:sent_followup_due',
       to_regclass('public.sent_messages_followup_due_v10426_idx') is not null
union all
select 'index:reply_followup_due',
       to_regclass('public.reply_history_followup_due_v10426_idx') is not null
union all
select 'index:stale_worker',
       to_regclass('public.message_schedules_global_stale_v10426_idx') is not null
union all
select 'index:due_worker',
       to_regclass('public.message_schedules_due_worker_v10426_idx') is not null
union all
select 'worker:configured',
       coalesce((public.scout_message_worker_status()->>'ready')::boolean, false)
union all
select 'worker:30-second-cadence',
       coalesce(public.scout_message_worker_status()->>'schedule','') in ('30 seconds','*/30 * * * * *')
union all
select 'followup:preview-smoke-test',
       (select count(*) >= 0 from public.get_due_followups(
         (select id from public.workspaces order by created_at asc limit 1),
         1,
         'all_unanswered',
         1,
         72,
         null,
         ''
       ));
