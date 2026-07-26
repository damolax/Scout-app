-- Scout v10.42.4 read-only verification
select 'schema:10.42.4' as requirement, exists(select 1 from public.scout_schema_versions where version='10.42.4') as passed
union all select 'rpc:stats', to_regprocedure('public.ready_email_detection_stats_v10424(uuid)') is not null
union all select 'rpc:page', to_regprocedure('public.ready_email_detection_page_v10424(uuid,text,text,timestamptz,uuid,integer)') is not null
union all select 'rpc:detect', to_regprocedure('public.run_ready_email_detection_v10424(uuid,integer,text,uuid[])') is not null
union all select 'rpc:redetect', to_regprocedure('public.queue_ready_email_redetection_v10424(uuid,uuid[],boolean)') is not null
union all select 'rpc:delete-invalid', to_regprocedure('public.delete_invalid_ready_detection_v10424(uuid)') is not null
union all select 'index:queue', to_regclass('public.businesses_ready_detection_queue_v10424_idx') is not null
union all select 'index:status', to_regclass('public.businesses_ready_detection_status_v10424_idx') is not null
union all select 'index:verified', to_regclass('public.businesses_ready_detection_verified_v10424_idx') is not null;
