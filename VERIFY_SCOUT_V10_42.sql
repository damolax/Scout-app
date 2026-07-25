-- Scout v10.42.1 safe verification. Read-only.
with required_tables(name) as (values
 ('import_jobs'),('import_job_rows'),('lead_dedupe_registry'),
 ('sender_health_daily'),('sender_limit_audit'),
 ('scouting_xp_state'),('scouting_xp_events')
), table_check as (
 select 'table:'||name as requirement, to_regclass('public.'||name) is not null as passed, 'required table'::text as detail
 from required_tables
), required_columns(table_name,column_name) as (values
 ('gmail_accounts','health_recommended_limit'),('gmail_accounts','health_score'),
 ('gmail_accounts','health_reliability'),('gmail_accounts','owner_override_limit'),
 ('gmail_accounts','owner_override_active'),('gmail_accounts','owner_override_until'),
 ('gmail_accounts','owner_override_locked'),('gmail_accounts','harmful_override_streak'),
 ('gmail_accounts','recovery_step'),('gmail_accounts','last_recovery_progress_day'),
 ('gmail_accounts','strict_disabled_at'),('gmail_accounts','last_health_metrics'),
 ('gmail_accounts','default_run_limit')
), column_check as (
 select 'column:'||r.table_name||'.'||r.column_name as requirement, c.column_name is not null as passed, 'required column'::text as detail
 from required_columns r left join information_schema.columns c
 on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
), function_check as (
 select * from (values
  ('rpc:process_import_job_batch_v1042',to_regprocedure('public.process_import_job_batch_v1042(uuid,integer)') is not null,'legacy background jobs remain recoverable'),
  ('rpc:import_businesses_bulk_v2',to_regprocedure('public.import_businesses_bulk_v2(uuid,uuid,text,jsonb,uuid,text)') is not null,'fast direct core importer'),
  ('rpc:award_scouting_xp_v1042',to_regprocedure('public.award_scouting_xp_v1042(uuid,text,integer,text,text,text,jsonb)') is not null,'permanent XP'),
  ('rpc:reserve_sender_send',to_regprocedure('public.reserve_sender_send(uuid,uuid,jsonb)') is not null,'daily limit and pacing reservation')
 ) v(requirement,passed,detail)
), version_check as (
 select 'schema:10.42.1' as requirement, exists(select 1 from public.scout_schema_versions where version='10.42.1') as passed, 'hotfix recorded'::text as detail
), default_check as (
 select 'sender-default-run:100' as requirement,
        not exists(select 1 from public.gmail_accounts where default_run_limit is null or default_run_limit=250) as passed,
        'default-generated values corrected to 100; owner custom values preserved'::text as detail
)
select * from table_check
union all select * from column_check
union all select * from function_check
union all select * from version_check
union all select * from default_check
order by requirement;
