
-- BEGIN SCOUT V10.42.5 READINESS AND PAGE STABILITY FIX
-- This section installs metadata-only readiness checks. It never executes the
-- message worker or performs a full follow-up queue scan from the Settings page.

create index if not exists businesses_contactable_readiness_v10425_idx
  on public.businesses (workspace_id, status)
  where email is not null and btrim(email) <> '';

create index if not exists message_schedules_worker_ping_v10425_idx
  on public.message_schedules (workspace_id, status, updated_at desc);

create index if not exists templates_readiness_v10425_idx
  on public.templates (workspace_id, active, template_type);

create or replace function public.scout_readiness_probe_v10425(target_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contactable_count bigint := null;
  contactable_error text := null;
  installed_version text := null;
  required_functions jsonb;
begin
  if target_workspace is null then
    raise exception 'target_workspace is required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'scout_message_worker_status', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='scout_message_worker_status'),
    'get_due_followups', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_due_followups'),
    'count_due_followups', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='count_due_followups'),
    'ready_email_detection_stats_v10424', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ready_email_detection_stats_v10424'),
    'ready_email_detection_page_v10424', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ready_email_detection_page_v10424'),
    'run_ready_email_detection_v10424', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='run_ready_email_detection_v10424'),
    'import_businesses_bulk_v2', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_businesses_bulk_v2'),
    'delete_pending_no_email_businesses', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_pending_no_email_businesses')
  ) into required_functions;

  begin
    perform set_config('statement_timeout', '3000', true);
    select count(*)
      into contactable_count
      from public.businesses
     where workspace_id = target_workspace
       and status in ('ready', 'found', 'connected')
       and email is not null
       and btrim(email) <> '';
  exception
    when query_canceled then
      contactable_error := 'Contactable lead count timed out; Scout will preserve the last confirmed value.';
      contactable_count := null;
    when others then
      contactable_error := sqlerrm;
      contactable_count := null;
  end;

  select version
    into installed_version
    from public.scout_schema_versions
   order by applied_at desc
   limit 1;

  return jsonb_build_object(
    'requiredFunctions', required_functions,
    'contactableLeads', contactable_count,
    'contactableCountError', contactable_error,
    'installedVersion', installed_version,
    'checkedAt', now()
  );
end;
$$;

revoke all on function public.scout_readiness_probe_v10425(uuid) from public, anon, authenticated;
grant execute on function public.scout_readiness_probe_v10425(uuid) to service_role;

create or replace function public.scout_message_worker_ping_v10425(target_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  worker_function_ready boolean := false;
  active_job_present boolean := false;
  latest_queue_update timestamptz := null;
  ping_error text := null;
begin
  if target_workspace is null then
    raise exception 'target_workspace is required' using errcode = '22023';
  end if;

  select exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='scout_message_worker_status'
  ) into worker_function_ready;

  begin
    perform set_config('statement_timeout', '2500', true);
    select exists(
      select 1
        from public.message_schedules
       where workspace_id = target_workspace
         and status in ('scheduled', 'due', 'running')
       limit 1
    ) into active_job_present;

    select max(updated_at)
      into latest_queue_update
      from (
        select updated_at
          from public.message_schedules
         where workspace_id = target_workspace
         order by updated_at desc
         limit 1
      ) recent;
  exception
    when query_canceled then
      ping_error := 'Worker queue ping timed out. No schema object is missing.';
    when others then
      ping_error := sqlerrm;
  end;

  return jsonb_build_object(
    'state', case when not worker_function_ready then 'missing' when ping_error is not null then 'degraded' else 'good' end,
    'workerFunctionReady', worker_function_ready,
    'activeJobPresent', active_job_present,
    'latestQueueUpdate', latest_queue_update,
    'error', ping_error,
    'checkedAt', now()
  );
end;
$$;

revoke all on function public.scout_message_worker_ping_v10425(uuid) from public, anon, authenticated;
grant execute on function public.scout_message_worker_ping_v10425(uuid) to service_role;

insert into public.scout_schema_versions (version, applied_at, notes)
values ('10.42.5', now(), 'Accurate degraded readiness classification, metadata-only probes, cached contactable counts and recoverable page loading.')
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_v10425_status,
  to_regprocedure('public.scout_readiness_probe_v10425(uuid)') is not null as readiness_probe_ready,
  to_regprocedure('public.scout_message_worker_ping_v10425(uuid)') is not null as worker_ping_ready,
  to_regclass('public.businesses_contactable_readiness_v10425_idx') is not null as contactable_index_ready,
  to_regclass('public.message_schedules_worker_ping_v10425_idx') is not null as worker_index_ready,
  exists(select 1 from public.scout_schema_versions where version='10.42.5') as version_recorded;
-- END SCOUT V10.42.5 READINESS AND PAGE STABILITY FIX
