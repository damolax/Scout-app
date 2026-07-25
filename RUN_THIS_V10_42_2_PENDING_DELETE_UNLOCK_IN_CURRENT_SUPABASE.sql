-- Scout v10.42.2 pending-no-email deletion and cancelled-import unlock hotfix
-- Run in Supabase SQL Editor for an existing v10.42/v10.42.1 project.

create or replace function public.delete_pending_no_email_businesses(target_workspace uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  delete from public.businesses
  where workspace_id = target_workspace
    and status in ('pending','scanning','found','review')
    and coalesce(nullif(btrim(email), ''), '') = '';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.delete_pending_no_email_businesses(uuid) to authenticated;

insert into public.scout_schema_versions(version, applied_at, notes)
values (
  '10.42.2',
  now(),
  'Pending no-email delete RPC, cancelled legacy import UI unlock, and clear CSV re-selection guidance'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_v10422_status,
  to_regprocedure('public.delete_pending_no_email_businesses(uuid)') is not null as delete_rpc_ready,
  exists(select 1 from public.scout_schema_versions where version = '10.42.2') as version_recorded;
