-- =============================================================================
-- SCOUT v10.42.0 — BACKGROUND IMPORT, ADAPTIVE SENDER HEALTH, PERMANENT XP
-- CURRENT PROJECT UPGRADE. Safe to run repeatedly.
-- This migration intentionally avoids building large indexes over existing tables.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Sender health and owner-limit controls
-- -----------------------------------------------------------------------------
alter table public.gmail_accounts add column if not exists health_recommended_limit integer not null default 250;
alter table public.gmail_accounts add column if not exists health_score numeric(6,2) not null default 100;
alter table public.gmail_accounts add column if not exists health_reliability text not null default 'insufficient_evidence';
alter table public.gmail_accounts add column if not exists owner_override_limit integer;
alter table public.gmail_accounts add column if not exists owner_override_active boolean not null default false;
alter table public.gmail_accounts add column if not exists owner_override_until timestamptz;
alter table public.gmail_accounts add column if not exists owner_override_locked boolean not null default false;
alter table public.gmail_accounts add column if not exists harmful_override_streak integer not null default 0;
alter table public.gmail_accounts add column if not exists last_harmful_override_day date;
alter table public.gmail_accounts add column if not exists recovery_step integer not null default 0;
alter table public.gmail_accounts add column if not exists last_recovery_progress_day date;
alter table public.gmail_accounts add column if not exists strict_disabled_at timestamptz;
alter table public.gmail_accounts add column if not exists last_health_metrics jsonb not null default '{}'::jsonb;

update public.gmail_accounts
set deployment_cap = least(250, greatest(1, coalesce(deployment_cap, 250))),
    deployment_run_cap = least(250, greatest(1, coalesce(deployment_run_cap, 250))),
    health_stage = case
      when coalesce(hard_restriction_active, false) then 'strict_disabled'
      when coalesce(health_stage, '') in ('paused') then health_stage
      when coalesce(health_stage, '') in ('restricted') and coalesce(health_cap, 0) = 0 then 'strict_disabled'
      else coalesce(nullif(health_stage, ''), 'assessment')
    end,
    health_recommended_limit = case
      when coalesce(hard_restriction_active, false) then 0
      when coalesce(health_stage, '') = 'paused' then 0
      else least(250, greatest(0, coalesce(health_recommended_limit, health_cap, 250)))
    end,
    health_cap = case
      when coalesce(hard_restriction_active, false) then 0
      when coalesce(health_stage, '') = 'paused' then 0
      else least(250, greatest(0, coalesce(health_cap, 250)))
    end,
    daily_limit = least(250, greatest(1, coalesce(daily_limit, 250))),
    default_run_limit = least(250, greatest(1, coalesce(default_run_limit, 250)))
where true;

create table if not exists public.sender_health_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  active_day date not null,
  attempted_count integer not null default 0,
  success_count integer not null default 0,
  permanent_bounce_count integer not null default 0,
  temporary_failure_count integer not null default 0,
  blocked_count integer not null default 0,
  no_inbox_count integer not null default 0,
  provider_limit_count integer not null default 0,
  real_reply_count integer not null default 0,
  health_score numeric(6,2) not null default 100,
  harmful boolean not null default false,
  override_active boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  unique(gmail_account_id, active_day)
);
create index if not exists sender_health_daily_account_day_idx
  on public.sender_health_daily(gmail_account_id, active_day desc);

create table if not exists public.sender_limit_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  previous_stage text,
  new_stage text,
  previous_recommended_limit integer,
  new_recommended_limit integer,
  owner_daily_limit integer,
  owner_override_limit integer,
  action text not null,
  reason text,
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists sender_limit_audit_account_created_idx
  on public.sender_limit_audit(gmail_account_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Persistent background import queue
-- -----------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text not null default 'csv_upload.csv',
  status text not null default 'uploading',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  email_rows integer not null default 0,
  no_email_rows integer not null default 0,
  staged_rows integer not null default 0,
  processed_rows integer not null default 0,
  inserted_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  invalid_rows integer not null default 0,
  suppressed_rows integer not null default 0,
  research_rows integer not null default 0,
  category_id uuid,
  category_name text,
  headers jsonb not null default '[]'::jsonb,
  enqueue_research boolean not null default false,
  worker_batch_size integer not null default 250,
  error_message text,
  last_progress_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists import_jobs_workspace_created_idx
  on public.import_jobs(workspace_id, created_at desc);
create index if not exists import_jobs_worker_idx
  on public.import_jobs(status, last_progress_at, created_at)
  where status in ('queued','processing');

create table if not exists public.import_job_rows (
  job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_no integer not null,
  dedupe_key text not null,
  row_data jsonb not null,
  status text not null default 'pending',
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(job_id, row_no)
);
create index if not exists import_job_rows_pending_idx
  on public.import_job_rows(job_id, status, row_no);

create table if not exists public.lead_dedupe_registry (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dedupe_key text not null,
  business_id uuid references public.businesses(id) on delete set null,
  first_import_job_id uuid references public.import_jobs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(workspace_id, dedupe_key)
);

alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;
alter table public.lead_dedupe_registry enable row level security;
alter table public.sender_health_daily enable row level security;
alter table public.sender_limit_audit enable row level security;

-- Service-role APIs perform mutations. Approved members may read their own workspace state.
drop policy if exists import_jobs_member_select on public.import_jobs;
create policy import_jobs_member_select on public.import_jobs for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists import_job_rows_member_select on public.import_job_rows;
create policy import_job_rows_member_select on public.import_job_rows for select to authenticated
using (exists(select 1 from public.import_jobs j where j.id=job_id and public.is_workspace_member(j.workspace_id)));
drop policy if exists sender_health_daily_member_select on public.sender_health_daily;
create policy sender_health_daily_member_select on public.sender_health_daily for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists sender_limit_audit_member_select on public.sender_limit_audit;
create policy sender_limit_audit_member_select on public.sender_limit_audit for select to authenticated
using (public.is_workspace_member(workspace_id));

revoke all on public.import_job_rows from anon, authenticated;
revoke all on public.lead_dedupe_registry from anon, authenticated;

-- Process one short, bounded batch. The dedicated registry replaces repeated full-table scans.
create or replace function public.process_import_job_batch_v1042(
  target_job uuid,
  requested_batch_size integer default 250
)
returns table(
  job_id uuid,
  job_status text,
  processed_now integer,
  inserted_now integer,
  duplicate_now integer,
  suppressed_now integer,
  remaining_rows bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workspace uuid;
  target_category_id uuid;
  target_category_name text;
  safe_batch integer := greatest(25, least(coalesce(requested_batch_size,250), 500));
  current_status text;
  picked_count integer := 0;
  inserted_count integer := 0;
  duplicate_count integer := 0;
  suppressed_count integer := 0;
  research_count integer := 0;
  remaining_count bigint := 0;
begin
  select workspace_id, category_id, category_name, status
    into target_workspace, target_category_id, target_category_name, current_status
  from public.import_jobs
  where id = target_job
  for update;

  if not found then raise exception 'Import job not found'; end if;
  if current_status in ('paused','cancelled','completed','completed_with_rejections') then
    return query select target_job, current_status, 0,0,0,0,
      (select count(*) from public.import_job_rows r where r.job_id=target_job and r.status='pending');
    return;
  end if;

  update public.import_jobs
  set status='processing', started_at=coalesce(started_at,now()), updated_at=now(), error_message=null
  where id=target_job;

  with picked as materialized (
    select r.job_id, r.row_no, r.dedupe_key, r.row_data
    from public.import_job_rows r
    where r.job_id=target_job and r.status='pending'
    order by r.row_no
    limit safe_batch
    for update skip locked
  ),
  parsed as materialized (
    select
      p.job_id,
      p.row_no,
      p.dedupe_key,
      nullif(trim(p.row_data->>'name'),'') as name,
      nullif(lower(trim(p.row_data->>'email')),'') as email,
      nullif(trim(p.row_data->>'phone'),'') as phone,
      nullif(trim(p.row_data->>'website'),'') as website,
      nullif(trim(p.row_data->>'domain'),'') as domain,
      coalesce(nullif(trim(target_category_name),''), nullif(trim(p.row_data->>'category'),'')) as category,
      nullif(trim(p.row_data->>'location'),'') as location,
      coalesce(nullif(trim(p.row_data->>'source'),''),'csv_upload') as source,
      coalesce(p.row_data->'raw','{}'::jsonb) as raw
    from picked p
  ),
  suppressed as materialized (
    select p.row_no, p.dedupe_key
    from parsed p
    where p.email is not null and exists (
      select 1 from public.no_inbox_records n
      where n.workspace_id=target_workspace and lower(n.email)=p.email
    )
  ),
  team_existing as materialized (
    select p.row_no, p.dedupe_key
    from parsed p
    join public.team_scouted_leads t on t.normalized_key=p.dedupe_key
    where t.first_workspace_id is distinct from target_workspace
  ),
  claimed as materialized (
    insert into public.lead_dedupe_registry(workspace_id,dedupe_key,first_import_job_id,first_seen_at,last_seen_at)
    select target_workspace,p.dedupe_key,target_job,now(),now()
    from parsed p
    where not exists(select 1 from suppressed s where s.row_no=p.row_no)
      and not exists(select 1 from team_existing t where t.row_no=p.row_no)
    on conflict(workspace_id,dedupe_key) do nothing
    returning dedupe_key
  ),
  inserted as materialized (
    insert into public.businesses(
      workspace_id,import_batch_id,name,email,phone,website,domain,category,category_id,category_name,
      location,source,status,score,normalized_key,raw,created_by
    )
    select
      target_workspace,null,p.name,p.email,p.phone,p.website,p.domain,p.category,target_category_id,target_category_name,
      p.location,p.source,case when p.email is not null then 'ready' else 'pending' end,
      case when p.email is not null then 75 else null end,p.dedupe_key,p.raw,
      (select created_by from public.import_jobs where id=target_job)
    from parsed p
    join claimed c on c.dedupe_key=p.dedupe_key
    on conflict(workspace_id,normalized_key) do nothing
    returning id,normalized_key
  ),
  registry_link as (
    update public.lead_dedupe_registry d
       set business_id=coalesce(d.business_id,i.id), last_seen_at=now()
      from inserted i
     where d.workspace_id=target_workspace and d.dedupe_key=i.normalized_key
    returning d.dedupe_key
  ),
  team_registry as (
    insert into public.team_scouted_leads(
      normalized_key,first_workspace_id,first_business_id,first_user_id,
      first_seen_at,last_seen_at,email,website,domain,name,source,raw
    )
    select
      i.normalized_key,target_workspace,i.id,
      (select created_by from public.import_jobs where id=target_job),
      now(),now(),p.email,p.website,p.domain,p.name,p.source,p.raw
    from inserted i
    join parsed p on p.dedupe_key=i.normalized_key
    on conflict(normalized_key) do update
      set last_seen_at=excluded.last_seen_at
    returning normalized_key
  ),
  research_jobs as (
    insert into public.email_research_jobs(
      workspace_id,business_id,status,priority,attempts,requested_by,created_at,updated_at
    )
    select
      target_workspace,i.id,'queued',100,0,
      (select created_by from public.import_jobs where id=target_job),now(),now()
    from inserted i
    join parsed p on p.dedupe_key=i.normalized_key
    where (select enqueue_research from public.import_jobs where id=target_job)
      and p.email is null
      and (p.website is not null or p.domain is not null)
    on conflict(workspace_id,business_id) do nothing
    returning business_id
  ),
  marked as (
    update public.import_job_rows r
       set status=case
         when exists(select 1 from suppressed s where s.row_no=r.row_no) then 'suppressed'
         when exists(select 1 from inserted i where i.normalized_key=r.dedupe_key) then 'inserted'
         else 'duplicate'
       end,
       processed_at=now(),
       error_message=null
     where r.job_id=target_job and exists(select 1 from picked p where p.row_no=r.row_no)
    returning r.status
  )
  select
    (select count(*) from picked),
    count(*) filter(where status='inserted'),
    count(*) filter(where status='duplicate'),
    count(*) filter(where status='suppressed'),
    (select count(*) from research_jobs)
  into picked_count,inserted_count,duplicate_count,suppressed_count,research_count
  from marked;

  select count(*) into remaining_count
  from public.import_job_rows r where r.job_id=target_job and r.status='pending';

  update public.import_jobs
     set processed_rows=processed_rows+picked_count,
         inserted_rows=inserted_rows+inserted_count,
         duplicate_rows=duplicate_rows+duplicate_count,
         suppressed_rows=suppressed_rows+suppressed_count,
         research_rows=research_rows+research_count,
         last_progress_at=now(),
         status=case
           when remaining_count=0 then case when invalid_rows+duplicate_rows+duplicate_count+suppressed_rows+suppressed_count>0 then 'completed_with_rejections' else 'completed' end
           else 'processing'
         end,
         completed_at=case when remaining_count=0 then now() else completed_at end,
         updated_at=now()
   where id=target_job;

  return query
  select target_job,
    (select status from public.import_jobs where id=target_job),
    picked_count,inserted_count,duplicate_count,suppressed_count,remaining_count;
end;
$$;
revoke all on function public.process_import_job_batch_v1042(uuid,integer) from public, anon, authenticated;
grant execute on function public.process_import_job_batch_v1042(uuid,integer) to service_role;

-- -----------------------------------------------------------------------------
-- Permanent Scouting XP
-- -----------------------------------------------------------------------------
create table if not exists public.scouting_xp_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  total_xp bigint not null default 0,
  baseline_xp bigint not null default 0,
  last_confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scouting_xp_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  points integer not null,
  unique_event_key text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(workspace_id, unique_event_key)
);
create index if not exists scouting_xp_events_workspace_created_idx
  on public.scouting_xp_events(workspace_id,created_at desc);

alter table public.scouting_xp_state enable row level security;
alter table public.scouting_xp_events enable row level security;
drop policy if exists scouting_xp_state_member_select on public.scouting_xp_state;
create policy scouting_xp_state_member_select on public.scouting_xp_state for select to authenticated
using(public.is_workspace_member(workspace_id));
drop policy if exists scouting_xp_events_member_select on public.scouting_xp_events;
create policy scouting_xp_events_member_select on public.scouting_xp_events for select to authenticated
using(public.is_workspace_member(workspace_id));

create or replace function public.award_scouting_xp_v1042(
  target_workspace uuid,
  target_event_type text,
  target_points integer,
  target_unique_event_key text,
  target_entity_type text default null,
  target_entity_id text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare awarded integer := 0; total bigint;
begin
  if target_workspace is null or nullif(trim(target_unique_event_key),'') is null then
    raise exception 'Workspace and unique event key are required';
  end if;
  insert into public.scouting_xp_events(workspace_id,event_type,points,unique_event_key,entity_type,entity_id,metadata)
  values(target_workspace,coalesce(nullif(trim(target_event_type),''),'activity'),greatest(target_points,0),target_unique_event_key,target_entity_type,target_entity_id,coalesce(target_metadata,'{}'::jsonb))
  on conflict(workspace_id,unique_event_key) do nothing;
  get diagnostics awarded = row_count;

  insert into public.scouting_xp_state(workspace_id,total_xp,baseline_xp,last_confirmed_at,updated_at)
  values(target_workspace,case when awarded=1 then greatest(target_points,0) else 0 end,0,now(),now())
  on conflict(workspace_id) do update
    set total_xp=scouting_xp_state.total_xp + case when awarded=1 then greatest(target_points,0) else 0 end,
        last_confirmed_at=now(),updated_at=now();

  select total_xp into total from public.scouting_xp_state where workspace_id=target_workspace;
  return coalesce(total,0);
end;
$$;
revoke all on function public.award_scouting_xp_v1042(uuid,text,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.award_scouting_xp_v1042(uuid,text,integer,text,text,text,jsonb) to service_role;

insert into public.scout_schema_versions(version,applied_at,notes)
values('10.42.0',now(),'Persistent background import queue, adaptive 250/day sender health and owner overrides, progressive auto-recovery, permanent Scouting XP.')
on conflict(version) do update set applied_at=excluded.applied_at,notes=excluded.notes;

notify pgrst,'reload schema';
select pg_notify('pgrst','reload schema');

select
  'READY'::text as scout_v1042_status,
  to_regclass('public.import_jobs') is not null as import_jobs_ready,
  to_regclass('public.import_job_rows') is not null as import_rows_ready,
  to_regclass('public.lead_dedupe_registry') is not null as dedupe_registry_ready,
  to_regprocedure('public.process_import_job_batch_v1042(uuid,integer)') is not null as import_worker_ready,
  to_regclass('public.sender_health_daily') is not null as sender_health_ready,
  to_regclass('public.scouting_xp_events') is not null as xp_ready,
  exists(select 1 from public.scout_schema_versions where version='10.42.0') as version_recorded;

-- v10.42 effective rolling-limit reservation. The campaign per-run limit is handled
-- in application code; this RPC enforces the final remaining 24-hour allowance.
create or replace function public.reserve_sender_send(
  target_workspace uuid,
  target_account uuid,
  reservation_raw jsonb default '{}'::jsonb
)
returns table(
  allowed boolean,
  reservation_id uuid,
  reason text,
  effective_daily_limit integer,
  used_last_24h integer,
  remaining integer,
  dispatch_at timestamptz,
  next_eligible_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.gmail_accounts%rowtype;
  deployment_limit integer;
  recommended_limit integer;
  health_ceiling integer;
  owner_daily_limit integer;
  effective_limit integer;
  used_count integer;
  new_reservation uuid;
  dispatch_time timestamptz;
  workspace_next timestamptz;
  next_time timestamptz;
  workspace_gap_seconds integer;
  override_active boolean;
  strict_disabled boolean;
begin
  select * into a
  from public.gmail_accounts
  where id=target_account and workspace_id=target_workspace
  for update;

  if not found then
    return query select false,null::uuid,'Sender account was not found.',0,0,0,null::timestamptz,null::timestamptz;
    return;
  end if;

  deployment_limit := greatest(1,least(250,coalesce(a.deployment_cap,250)));
  strict_disabled := lower(coalesce(a.health_stage,''))='strict_disabled'
    or coalesce(a.owner_override_locked,false)
    or coalesce(a.hard_restriction_active,false);
  override_active := coalesce(a.owner_override_active,false)
    and not coalesce(a.owner_override_locked,false)
    and (a.owner_override_until is null or a.owner_override_until>now());

  if strict_disabled then
    return query select false,null::uuid,
      coalesce(a.hard_restriction_reason,a.health_reason,'This Gmail is strictly disabled. Scout will automatically unlock it after the recovery conditions pass.'),
      0,0,0,null::timestamptz,a.next_eligible_at;
    return;
  end if;

  if coalesce(a.pause_kind,'')='manual' or coalesce(a.is_paused,false) or lower(coalesce(a.status,'')) in ('paused','limit_hit','blocked','error') then
    return query select false,null::uuid,coalesce(a.paused_reason,a.health_reason,a.last_error,'Sender is paused.'),0,0,0,null::timestamptz,a.next_eligible_at;
    return;
  end if;

  recommended_limit := greatest(0,least(deployment_limit,coalesce(
    a.health_recommended_limit,
    a.health_cap,
    case lower(coalesce(a.health_stage,'assessment'))
      when 'healthy' then 250
      when 'assessment' then 250
      when 'watch' then 175
      when 'restricted' then 100
      when 'critical' then 50
      when 'recovering' then case greatest(0,least(4,coalesce(a.recovery_step,0)))
        when 0 then 25 when 1 then 50 when 2 then 100 when 3 then 175 else 250 end
      when 'stable' then 175
      when 'established' then 250
      when 'proven' then 250
      else 250
    end
  )));

  health_ceiling := case when override_active
    then greatest(1,least(deployment_limit,coalesce(a.owner_override_limit,recommended_limit)))
    else recommended_limit end;
  owner_daily_limit := greatest(1,least(deployment_limit,coalesce(a.daily_limit,deployment_limit)));
  effective_limit := greatest(0,least(deployment_limit,health_ceiling,owner_daily_limit));

  select count(*)::integer into used_count
  from public.sender_send_reservations r
  where r.workspace_id=target_workspace
    and r.gmail_account_id=target_account
    and ((r.status='sent' and r.finalized_at>=now()-interval '24 hours')
      or (r.status='reserved' and r.expires_at>now()));

  if a.next_eligible_at is not null and a.next_eligible_at>now() then
    return query select false,null::uuid,'Sender cooldown is still active.',effective_limit,used_count,greatest(0,effective_limit-used_count),null::timestamptz,a.next_eligible_at;
    return;
  end if;

  if effective_limit<=0 or used_count>=effective_limit then
    return query select false,null::uuid,'Sender reached its effective rolling 24-hour limit.',effective_limit,used_count,greatest(0,effective_limit-used_count),null::timestamptz,a.next_eligible_at;
    return;
  end if;

  insert into public.workspace_dispatch_state(workspace_id,next_dispatch_at)
  values(target_workspace,now()) on conflict(workspace_id) do nothing;
  select s.next_dispatch_at into workspace_next from public.workspace_dispatch_state s
  where s.workspace_id=target_workspace for update;
  dispatch_time := greatest(now(),coalesce(workspace_next,now()));
  if dispatch_time>now()+interval '45 seconds' then
    return query select false,null::uuid,'Workspace dispatch slots are full for this worker cycle. Scout will retry automatically.',effective_limit,used_count,greatest(0,effective_limit-used_count),dispatch_time,a.next_eligible_at;
    return;
  end if;

  workspace_gap_seconds := 3+floor(random()*4)::integer;
  update public.workspace_dispatch_state set next_dispatch_at=dispatch_time+make_interval(secs=>workspace_gap_seconds),updated_at=now()
  where workspace_id=target_workspace;
  next_time := dispatch_time+make_interval(secs=>(90+floor(random()*121))::integer);

  insert into public.sender_send_reservations(workspace_id,gmail_account_id,status,effective_daily_limit,used_before,dispatch_at,expires_at,raw)
  values(target_workspace,target_account,'reserved',effective_limit,used_count,dispatch_time,dispatch_time+interval '10 minutes',coalesce(reservation_raw,'{}'::jsonb))
  returning id into new_reservation;

  update public.gmail_accounts set next_eligible_at=next_time,health_cap=recommended_limit,health_recommended_limit=recommended_limit,updated_at=now()
  where id=target_account and workspace_id=target_workspace;

  return query select true,new_reservation,'Reserved.',effective_limit,used_count,greatest(0,effective_limit-used_count-1),dispatch_time,next_time;
end;
$$;
revoke all on function public.reserve_sender_send(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_sender_send(uuid,uuid,jsonb) to service_role;

select
  'READY'::text as scout_v1042_final_status,
  to_regprocedure('public.reserve_sender_send(uuid,uuid,jsonb)') is not null as final_sender_limit_rpc_ready,
  to_regprocedure('public.process_import_job_batch_v1042(uuid,integer)') is not null as background_import_rpc_ready,
  exists(select 1 from public.scout_schema_versions where version='10.42.0') as version_recorded;


-- Scout v10.42.1 fast-import and sender-run default hotfix
-- Safe to run in the current Supabase project after v10.42.0.

alter table if exists public.gmail_accounts
  alter column default_run_limit set default 100;

-- Correct only the v10.42-generated 250 default or missing values.
-- Owner-selected lower/custom values are preserved.
update public.gmail_accounts
set default_run_limit = 100,
    updated_at = now()
where default_run_limit is null
   or default_run_limit = 250;

insert into public.scout_schema_versions(version, applied_at, notes)
values ('10.42.1', now(), 'Fast direct core import, default max per run 100, same-Gmail 90-210s and different-Gmail 3-6s pacing preserved')
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_v10421_status,
  (select count(*) from public.gmail_accounts where default_run_limit = 100) as senders_at_default_100,
  exists(select 1 from public.scout_schema_versions where version='10.42.1') as version_recorded,
  '90-210 seconds'::text as same_gmail_delay,
  '3-6 seconds'::text as different_gmail_delay;


-- BEGIN SCOUT V10.42.4 READY DETECTION PERFORMANCE
-- Scout v10.42.4 — Ready Email Detection performance repair
-- Run in the current Scout Supabase project before deploying v10.42.4.
-- This migration is idempotent and contains no destructive lead changes.

create index if not exists businesses_ready_detection_queue_v10424_idx
  on public.businesses(workspace_id, updated_at desc, id desc)
  where email is not null
    and btrim(email) <> ''
    and status in ('pending','found','review')
    and email_verified_at is null;

create index if not exists businesses_ready_detection_status_v10424_idx
  on public.businesses(workspace_id, status, updated_at desc, id desc);

create index if not exists businesses_ready_detection_verified_v10424_idx
  on public.businesses(workspace_id, email_verified_at desc, id desc)
  where email_verified_at is not null;

create or replace function public.ready_email_detection_stats_v10424(target_workspace uuid)
returns table(
  total_count bigint,
  has_email_count bigint,
  found_count bigint,
  ready_count bigint,
  review_count bigint,
  invalid_no_inbox_count bigint,
  needs_detection_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(target_workspace)) then
    raise exception 'Not authorized for this workspace';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where b.email is not null and btrim(b.email) <> '')::bigint,
    count(*) filter (where b.status = 'found')::bigint,
    count(*) filter (where b.status = 'ready')::bigint,
    count(*) filter (where b.status = 'review')::bigint,
    count(*) filter (where b.status in ('invalid','no_inbox','bounced','blocked'))::bigint,
    count(*) filter (
      where b.email is not null
        and btrim(b.email) <> ''
        and b.status in ('pending','found','review')
        and b.email_verified_at is null
        and not (coalesce(b.raw, '{}'::jsonb) ? 'verification')
        and not (coalesce(b.raw, '{}'::jsonb) ? 'ready_email_detection')
    )::bigint
  from public.businesses b
  where b.workspace_id = target_workspace;
end;
$$;

grant execute on function public.ready_email_detection_stats_v10424(uuid) to authenticated;

create or replace function public.ready_email_detection_page_v10424(
  target_workspace uuid,
  target_filter text default 'needs_verification',
  target_search text default null,
  before_updated_at timestamptz default null,
  before_id uuid default null,
  page_limit integer default 101
)
returns table(
  id uuid,
  workspace_id uuid,
  name text,
  email text,
  website text,
  domain text,
  category text,
  category_id uuid,
  category_name text,
  location text,
  source text,
  status text,
  score integer,
  normalized_key text,
  raw jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  email_verification_status text,
  email_verification_level text,
  email_verified_at timestamptz,
  email_verification_reason text,
  email_role_label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_filter text := coalesce(nullif(btrim(target_filter), ''), 'needs_verification');
  clean_search text := nullif(btrim(target_search), '');
  safe_limit integer := least(greatest(coalesce(page_limit, 101), 1), 101);
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(target_workspace)) then
    raise exception 'Not authorized for this workspace';
  end if;

  return query
  select
    b.id,
    b.workspace_id,
    b.name,
    b.email,
    b.website,
    b.domain,
    b.category,
    b.category_id,
    b.category_name,
    b.location,
    b.source,
    b.status,
    b.score,
    b.normalized_key,
    case
      when coalesce(b.raw, '{}'::jsonb) ? 'verification' then jsonb_build_object('verification', b.raw -> 'verification')
      when coalesce(b.raw, '{}'::jsonb) ? 'ready_email_detection' then jsonb_build_object('verification', b.raw -> 'ready_email_detection')
      else '{}'::jsonb
    end as raw,
    b.created_at,
    b.updated_at,
    b.email_verification_status,
    b.email_verification_level,
    b.email_verified_at,
    b.email_verification_reason,
    b.email_role_label
  from public.businesses b
  where b.workspace_id = target_workspace
    and (
      clean_filter = 'all'
      or (clean_filter = 'has_email' and b.email is not null and btrim(b.email) <> '')
      or (clean_filter = 'ready' and b.status = 'ready')
      or (clean_filter = 'review' and b.status = 'review')
      or (clean_filter = 'invalid' and b.status in ('invalid','no_inbox','bounced','blocked'))
      or (
        clean_filter = 'needs_verification'
        and b.email is not null
        and btrim(b.email) <> ''
        and b.status in ('pending','found','review')
        and b.email_verified_at is null
        and not (coalesce(b.raw, '{}'::jsonb) ? 'verification')
        and not (coalesce(b.raw, '{}'::jsonb) ? 'ready_email_detection')
      )
    )
    and (
      clean_search is null
      or coalesce(b.name, '') ilike '%' || clean_search || '%'
      or coalesce(b.email, '') ilike '%' || clean_search || '%'
      or coalesce(b.domain, '') ilike '%' || clean_search || '%'
      or coalesce(b.website, '') ilike '%' || clean_search || '%'
    )
    and (
      before_updated_at is null
      or b.updated_at < before_updated_at
      or (b.updated_at = before_updated_at and b.id < coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by b.updated_at desc, b.id desc
  limit safe_limit;
end;
$$;

grant execute on function public.ready_email_detection_page_v10424(uuid,text,text,timestamptz,uuid,integer) to authenticated;

create or replace function public.run_ready_email_detection_v10424(
  target_workspace uuid,
  target_limit integer default 2000,
  target_search text default null,
  target_ids uuid[] default null
)
returns table(
  checked_count integer,
  ready_count integer,
  review_count integer,
  invalid_count integer,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_limit integer := least(greatest(coalesce(target_limit, 2000), 1), 2000);
  clean_search text := nullif(btrim(target_search), '');
  run_at timestamptz := clock_timestamp();
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(target_workspace)) then
    raise exception 'Not authorized for this workspace';
  end if;

  return query
  with targets as materialized (
    select
      b.id,
      b.email,
      lower(split_part(btrim(b.email), '@', 1)) as prefix,
      lower(split_part(btrim(b.email), '@', 2)) as email_domain
    from public.businesses b
    where b.workspace_id = target_workspace
      and b.email is not null
      and btrim(b.email) <> ''
      and (
        (target_ids is not null and b.id = any(target_ids))
        or (
          target_ids is null
          and b.status in ('pending','found','review')
          and b.email_verified_at is null
          and not (coalesce(b.raw, '{}'::jsonb) ? 'verification')
          and not (coalesce(b.raw, '{}'::jsonb) ? 'ready_email_detection')
        )
      )
      and (
        clean_search is null
        or coalesce(b.name, '') ilike '%' || clean_search || '%'
        or coalesce(b.email, '') ilike '%' || clean_search || '%'
        or coalesce(b.domain, '') ilike '%' || clean_search || '%'
        or coalesce(b.website, '') ilike '%' || clean_search || '%'
      )
    order by b.updated_at asc, b.id asc
    limit safe_limit
    for update skip locked
  ), classified as (
    select
      t.*,
      (btrim(t.email) ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$') as valid_format,
      (t.email_domain = any(array['mailinator.com','10minutemail.com','tempmail.com','guerrillamail.com','yopmail.com','trashmail.com'])) as disposable,
      (t.prefix = any(array['info','support','hello','contact','sales','admin','office','service','shop','orders','team','crm'])) as role_based,
      (t.email_domain = any(array['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','proton.me','protonmail.com'])) as free_provider
    from targets t
  ), prepared as (
    select
      c.*,
      case when not c.valid_format then 'invalid'
           when c.disposable then 'invalid'
           else 'ready' end as next_status,
      case when not c.valid_format then 'bad_format'
           when c.disposable then 'invalid'
           else 'valid' end as detection_status,
      case when not c.valid_format then 0
           when c.disposable then 10
           when c.role_based then 90
           when c.free_provider then 82
           else 88 end as next_score,
      case when not c.valid_format then 'Invalid email format or missing domain.'
           when c.disposable then 'Disposable/temporary email domain.'
           when c.role_based then 'Valid format and role/business inbox style. Accepted for outreach.'
           when c.free_provider then 'Valid format and personal/free-mail inbox style. Accepted for outreach, but watch bounce/reply results.'
           else 'Valid format and business-domain email. Accepted for outreach.' end as reason
    from classified c
  ), payloads as (
    select
      p.*,
      jsonb_build_object(
        'email', lower(btrim(p.email)),
        'status', p.detection_status,
        'score', p.next_score,
        'readyToContact', p.next_status = 'ready',
        'provider', 'free_ready_detector',
        'providerReason', p.reason,
        'validFormat', p.valid_format,
        'hasMx', null,
        'isRoleBased', p.role_based,
        'isFreeProvider', p.free_provider,
        'checkedAt', run_at
      ) as verification_json
    from prepared p
  ), updated as (
    update public.businesses b
    set
      status = p.next_status,
      score = p.next_score,
      email_verification_status = p.detection_status,
      email_verification_level = 'basic',
      email_verified_at = run_at,
      email_verification_reason = p.reason,
      email_role_label = case when p.role_based then p.prefix else null end,
      raw = jsonb_set(
        jsonb_set(coalesce(b.raw, '{}'::jsonb), '{verification}', p.verification_json, true),
        '{ready_email_detection}', p.verification_json, true
      ) || jsonb_build_object('verification_checked_at', run_at),
      updated_at = run_at
    from payloads p
    where b.id = p.id and b.workspace_id = target_workspace
    returning b.id, b.workspace_id, lower(btrim(b.email)) as email, b.status, b.score, b.raw
  ), candidates as (
    insert into public.email_candidates(workspace_id,business_id,email,source,score,status,raw)
    select u.workspace_id,u.id,u.email,'free_ready_detector',u.score,
           coalesce(u.raw->'verification'->>'status', u.status),
           coalesce(u.raw->'verification','{}'::jsonb)
    from updated u
    on conflict (workspace_id,business_id,email)
    do update set
      source = excluded.source,
      score = excluded.score,
      status = excluded.status,
      raw = excluded.raw
    returning 1
  )
  select
    count(*)::integer,
    count(*) filter (where u.status = 'ready')::integer,
    count(*) filter (where u.status = 'review')::integer,
    count(*) filter (where u.status = 'invalid')::integer,
    run_at
  from updated u;
end;
$$;

grant execute on function public.run_ready_email_detection_v10424(uuid,integer,text,uuid[]) to authenticated;

create or replace function public.queue_ready_email_redetection_v10424(
  target_workspace uuid,
  target_ids uuid[],
  clear_email boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
  run_at timestamptz := clock_timestamp();
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(target_workspace)) then
    raise exception 'Not authorized for this workspace';
  end if;
  if coalesce(array_length(target_ids, 1), 0) = 0 then return 0; end if;

  with changed as (
    update public.businesses b
    set
      email = case when clear_email then null else b.email end,
      status = 'pending',
      email_verification_status = 'unchecked',
      email_verification_level = null,
      email_verified_at = null,
      email_verification_reason = null,
      email_role_label = null,
      email_mx_hosts = '{}'::text[],
      raw = (coalesce(b.raw, '{}'::jsonb) - 'verification' - 'ready_email_detection' - 'verification_checked_at')
        || jsonb_build_object(
          'redetect_requested_at', run_at,
          'redetect_reason', case when clear_email then 'selected_from_verify_clear_email' else 'selected_from_verify' end
        ),
      updated_at = run_at
    where b.workspace_id = target_workspace and b.id = any(target_ids)
    returning b.id
  ), queued as (
    insert into public.email_research_jobs(workspace_id,business_id,status,attempts,priority)
    select target_workspace,c.id,'queued',0,250 from changed c
    on conflict (workspace_id,business_id)
    do update set status='queued',attempts=0,priority=250,last_error=null,updated_at=run_at
    returning 1
  )
  select count(*)::integer into queued_count from queued;

  return queued_count;
end;
$$;

grant execute on function public.queue_ready_email_redetection_v10424(uuid,uuid[],boolean) to authenticated;

create or replace function public.delete_invalid_ready_detection_v10424(target_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if not (auth.role() = 'service_role' or public.is_workspace_member(target_workspace)) then
    raise exception 'Not authorized for this workspace';
  end if;

  with deleted as (
    delete from public.businesses b
    where b.workspace_id = target_workspace
      and b.status in ('invalid','no_inbox','bounced','blocked')
    returning 1
  )
  select count(*)::integer into deleted_count from deleted;

  return deleted_count;
end;
$$;

grant execute on function public.delete_invalid_ready_detection_v10424(uuid) to authenticated;

insert into public.scout_schema_versions(version, applied_at, notes)
values ('10.42.4', now(), 'Indexed Ready Email Detection page, combined stats, cursor pagination and set-based detector')
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_v10424_status,
  to_regprocedure('public.ready_email_detection_stats_v10424(uuid)') is not null as stats_rpc_ready,
  to_regprocedure('public.ready_email_detection_page_v10424(uuid,text,text,timestamptz,uuid,integer)') is not null as page_rpc_ready,
  to_regprocedure('public.run_ready_email_detection_v10424(uuid,integer,text,uuid[])') is not null as detection_rpc_ready,
  to_regprocedure('public.queue_ready_email_redetection_v10424(uuid,uuid[],boolean)') is not null as redetection_rpc_ready,
  to_regprocedure('public.delete_invalid_ready_detection_v10424(uuid)') is not null as delete_rpc_ready,
  to_regclass('public.businesses_ready_detection_queue_v10424_idx') is not null as queue_index_ready,
  exists(select 1 from public.scout_schema_versions where version='10.42.4') as version_recorded;

-- END SCOUT V10.42.4 READY DETECTION PERFORMANCE

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
