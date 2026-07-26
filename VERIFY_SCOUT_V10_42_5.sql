-- Scout v10.42.5 read-only verification
select 'schema:10.42.5' as requirement,
       exists(select 1 from public.scout_schema_versions where version='10.42.5') as passed
union all
select 'rpc:scout_readiness_probe_v10425',
       to_regprocedure('public.scout_readiness_probe_v10425(uuid)') is not null
union all
select 'rpc:scout_message_worker_ping_v10425',
       to_regprocedure('public.scout_message_worker_ping_v10425(uuid)') is not null
union all
select 'index:businesses_contactable_readiness_v10425_idx',
       to_regclass('public.businesses_contactable_readiness_v10425_idx') is not null
union all
select 'index:message_schedules_worker_ping_v10425_idx',
       to_regclass('public.message_schedules_worker_ping_v10425_idx') is not null
union all
select 'rpc:ready_email_detection_stats_v10424',
       to_regprocedure('public.ready_email_detection_stats_v10424(uuid)') is not null
union all
select 'rpc:ready_email_detection_page_v10424',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ready_email_detection_page_v10424')
union all
select 'rpc:run_ready_email_detection_v10424',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='run_ready_email_detection_v10424');
