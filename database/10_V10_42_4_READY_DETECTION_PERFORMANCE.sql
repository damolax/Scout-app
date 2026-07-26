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
