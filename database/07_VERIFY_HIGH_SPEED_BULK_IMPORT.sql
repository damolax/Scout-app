-- Read-only verification for Scout v10.41 high-speed bulk import.
select 'schema_version' as requirement,
       exists(select 1 from public.scout_schema_versions where version = '10.41.0') as passed
union all
select 'receipt_table', to_regclass('public.import_chunk_receipts') is not null
union all
select 'bulk_import_rpc', to_regprocedure('public.import_businesses_bulk_v2(uuid,uuid,text,jsonb,uuid,text)') is not null
union all
select 'progress_rpc', to_regprocedure('public.get_import_batch_progress_v2(uuid,uuid)') is not null
union all
select 'finalize_rpc', to_regprocedure('public.finalize_import_batch_v2(uuid,uuid,integer,integer)') is not null
union all
select 'batch_key_index', to_regclass('public.businesses_import_batch_key_idx') is not null
union all
select 'receipt_index', to_regclass('public.import_chunk_receipts_workspace_batch_idx') is not null;
