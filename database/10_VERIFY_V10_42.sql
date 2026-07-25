-- Scout v10.42.0 safe verification. Read-only.
with required_tables(name) as (values
 ('import_jobs'),('import_job_rows'),('lead_dedupe_registry'),
 ('sender_health_daily'),('sender_limit_audit'),
 ('scouting_xp_state'),('scouting_xp_events')
), table_check as (
 select 'table:'||name as requirement, to_regclass('public.'||name) is not null as passed
 from required_tables
), required_columns(table_name,column_name) as (values
 ('gmail_accounts','health_recommended_limit'),('gmail_accounts','health_score'),
 ('gmail_accounts','health_reliability'),('gmail_accounts','owner_override_limit'),
 ('gmail_accounts','owner_override_active'),('gmail_accounts','owner_override_until'),
 ('gmail_accounts','owner_override_locked'),('gmail_accounts','harmful_override_streak'),
 ('gmail_accounts','recovery_step'),('gmail_accounts','last_recovery_progress_day'),
 ('gmail_accounts','strict_disabled_at'),('gmail_accounts','last_health_metrics')
), column_check as (
 select 'column:'||r.table_name||'.'||r.column_name as requirement, c.column_name is not null as passed
 from required_columns r left join information_schema.columns c
 on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
), function_check as (
 select * from (values
  ('rpc:process_import_job_batch_v1042',to_regprocedure('public.process_import_job_batch_v1042(uuid,integer)') is not null),
  ('rpc:award_scouting_xp_v1042',to_regprocedure('public.award_scouting_xp_v1042(uuid,text,integer,text,text,text,jsonb)') is not null),
  ('rpc:reserve_sender_send',to_regprocedure('public.reserve_sender_send(uuid,uuid,jsonb)') is not null)
 ) v(requirement,passed)
), version_check as (
 select 'schema:10.42.0' as requirement, exists(select 1 from public.scout_schema_versions where version='10.42.0') as passed
)
select * from table_check
union all select * from column_check
union all select * from function_check
union all select * from version_check
order by requirement;
