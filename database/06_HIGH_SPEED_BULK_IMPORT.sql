-- =============================================================================
-- SCOUT v10.41.0 HIGH-SPEED CSV BULK IMPORT
-- Run once in the CURRENT Supabase project before deploying the v10.41 app code.
-- Safe to run repeatedly.
--
-- Improvements:
--   * set-based imports instead of row-trigger work
--   * idempotent chunk receipts so retries never double-count
--   * atomic team duplicate claiming across concurrent imports
--   * bulk team registry enrichment
--   * resumable progress/finalization RPCs
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.import_chunk_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  chunk_key text not null,
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_queue_count integer not null default 0,
  skipped_history_count integer not null default 0,
  skipped_team_count integer not null default 0,
  skipped_keys text[] not null default '{}'::text[],
  skipped_keys_truncated boolean not null default false,
  completed_at timestamptz not null default now(),
  primary key (batch_id, chunk_key)
);

create index if not exists import_chunk_receipts_workspace_batch_idx
  on public.import_chunk_receipts(workspace_id, batch_id, completed_at);

create index if not exists businesses_import_batch_key_idx
  on public.businesses(import_batch_id, normalized_key)
  where import_batch_id is not null;

alter table public.import_chunk_receipts enable row level security;

-- Browser users never need direct access to receipt rows. The security-definer RPCs below
-- validate workspace membership and expose only aggregate import results.
revoke all on public.import_chunk_receipts from anon, authenticated;

-- During a bulk import, the RPC registers imported leads in one set-based operation.
-- Regular inserts and updates still use this trigger exactly as before.
create or replace function public.record_team_scouted_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('scout.bulk_import', true) = 'on' then
    return new;
  end if;

  if nullif(trim(coalesce(new.normalized_key, '')), '') is null then
    return new;
  end if;

  insert into public.team_scouted_leads (
    normalized_key,
    first_workspace_id,
    first_business_id,
    first_user_id,
    first_seen_at,
    last_seen_at,
    email,
    website,
    domain,
    name,
    source,
    raw
  )
  values (
    new.normalized_key,
    new.workspace_id,
    new.id,
    new.created_by,
    coalesce(new.created_at, now()),
    now(),
    nullif(new.email, ''),
    nullif(new.website, ''),
    nullif(new.domain, ''),
    nullif(new.name, ''),
    nullif(new.source, ''),
    jsonb_build_object('status', new.status, 'recorded_at', now())
  )
  on conflict (normalized_key) do update
    set last_seen_at = now();

  return new;
end;
$$;

create or replace function public.import_businesses_bulk_v2(
  target_workspace uuid,
  target_batch_id uuid,
  target_chunk_key text,
  input_rows jsonb,
  target_category_id uuid default null,
  target_category_name text default null
)
returns table(
  row_count int,
  inserted_count int,
  skipped_queue_count int,
  skipped_history_count int,
  skipped_team_count int,
  skipped_keys text[],
  skipped_keys_truncated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  final_category_id uuid := target_category_id;
  final_category_name text := nullif(trim(target_category_name), '');
  clean_chunk_key text := nullif(trim(target_chunk_key), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  if clean_chunk_key is null then
    raise exception 'Chunk key is required';
  end if;

  if jsonb_typeof(coalesce(input_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Input rows must be a JSON array';
  end if;

  if jsonb_array_length(coalesce(input_rows, '[]'::jsonb)) > 10000 then
    raise exception 'A bulk import chunk cannot exceed 10000 rows';
  end if;

  if not exists (
    select 1
    from public.import_batches b
    where b.id = target_batch_id
      and b.workspace_id = target_workspace
  ) then
    raise exception 'Import batch does not belong to this workspace';
  end if;

  -- One chunk is processed by only one transaction at a time. A retry receives the
  -- original receipt instead of redoing work or changing counts.
  perform pg_advisory_xact_lock(hashtextextended(target_batch_id::text || ':' || clean_chunk_key, 0));

  return query
  select
    r.row_count,
    r.inserted_count,
    r.skipped_queue_count,
    r.skipped_history_count,
    r.skipped_team_count,
    r.skipped_keys,
    r.skipped_keys_truncated
  from public.import_chunk_receipts r
  where r.workspace_id = target_workspace
    and r.batch_id = target_batch_id
    and r.chunk_key = clean_chunk_key;

  if found then
    return;
  end if;

  if final_category_id is null and final_category_name is not null then
    final_category_id := public.ensure_message_category(target_workspace, final_category_name, null);
  end if;

  if final_category_id is not null then
    select c.name
      into final_category_name
    from public.message_categories c
    where c.id = final_category_id
      and c.workspace_id = target_workspace;

    if not found then
      raise exception 'Audience category does not belong to this workspace';
    end if;
  end if;

  perform set_config('scout.bulk_import', 'on', true);

  return query
  with incoming as materialized (
    select
      nullif(trim(x.name), '') as name,
      nullif(trim(lower(x.email)), '') as email,
      nullif(trim(x.phone), '') as phone,
      nullif(trim(x.website), '') as website,
      nullif(trim(x.domain), '') as domain,
      coalesce(final_category_name, nullif(trim(x.category), '')) as category,
      final_category_id as category_id,
      final_category_name as category_name,
      nullif(trim(x.location), '') as location,
      coalesce(nullif(trim(x.source), ''), 'csv_upload') as source,
      nullif(trim(x.normalized_key), '') as normalized_key,
      coalesce(x.raw, '{}'::jsonb) as raw
    from jsonb_to_recordset(coalesce(input_rows, '[]'::jsonb)) as x(
      name text,
      email text,
      phone text,
      website text,
      domain text,
      category text,
      location text,
      source text,
      normalized_key text,
      raw jsonb
    )
    where nullif(trim(x.normalized_key), '') is not null
  ),
  deduped as materialized (
    select distinct on (i.normalized_key) i.*
    from incoming i
    order by i.normalized_key
  ),
  queue_existing as materialized (
    select d.normalized_key
    from deduped d
    join public.businesses b
      on b.workspace_id = target_workspace
     and b.normalized_key = d.normalized_key
  ),
  history_existing as materialized (
    select d.normalized_key
    from deduped d
    join public.scout_history h
      on h.workspace_id = target_workspace
     and h.normalized_key = d.normalized_key
    where not exists (
      select 1 from queue_existing q where q.normalized_key = d.normalized_key
    )
  ),
  team_other_before as materialized (
    select d.normalized_key
    from deduped d
    join public.team_scouted_leads t
      on t.normalized_key = d.normalized_key
    where t.first_workspace_id is distinct from target_workspace
      and not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
      and not exists (select 1 from history_existing h where h.normalized_key = d.normalized_key)
  ),
  team_same_before as materialized (
    select d.normalized_key
    from deduped d
    join public.team_scouted_leads t
      on t.normalized_key = d.normalized_key
    where t.first_workspace_id = target_workspace
      and not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
      and not exists (select 1 from history_existing h where h.normalized_key = d.normalized_key)
  ),
  claim_candidates as materialized (
    select d.*
    from deduped d
    where not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
      and not exists (select 1 from history_existing h where h.normalized_key = d.normalized_key)
      and not exists (select 1 from team_other_before t where t.normalized_key = d.normalized_key)
      and not exists (select 1 from team_same_before t where t.normalized_key = d.normalized_key)
  ),
  claimed as (
    insert into public.team_scouted_leads (
      normalized_key,
      first_workspace_id,
      first_business_id,
      first_user_id,
      first_seen_at,
      last_seen_at,
      email,
      website,
      domain,
      name,
      source,
      raw
    )
    select
      c.normalized_key,
      target_workspace,
      null,
      auth.uid(),
      now(),
      now(),
      c.email,
      c.website,
      c.domain,
      c.name,
      c.source,
      jsonb_build_object('claimed_by_bulk_import', true, 'batch_id', target_batch_id)
    from claim_candidates c
    on conflict (normalized_key) do update
      set last_seen_at = team_scouted_leads.last_seen_at
    returning normalized_key, first_workspace_id
  ),
  race_lost_team as materialized (
    select c.normalized_key
    from claim_candidates c
    where not exists (
      select 1
      from claimed n
      where n.normalized_key = c.normalized_key
        and n.first_workspace_id = target_workspace
    )
  ),
  allowed as materialized (
    select d.*
    from deduped d
    where exists (select 1 from team_same_before s where s.normalized_key = d.normalized_key)
       or exists (
         select 1
         from claimed c
         where c.normalized_key = d.normalized_key
           and c.first_workspace_id = target_workspace
       )
  ),
  inserted as (
    insert into public.businesses (
      workspace_id,
      import_batch_id,
      name,
      email,
      phone,
      website,
      domain,
      category,
      category_id,
      category_name,
      location,
      source,
      status,
      score,
      normalized_key,
      raw,
      created_by
    )
    select
      target_workspace,
      target_batch_id,
      a.name,
      a.email,
      a.phone,
      a.website,
      a.domain,
      a.category,
      a.category_id,
      a.category_name,
      a.location,
      a.source,
      case when coalesce(a.email, '') <> '' then 'ready' else 'pending' end,
      case when coalesce(a.email, '') <> '' then 75 else null end,
      a.normalized_key,
      a.raw,
      auth.uid()
    from allowed a
    on conflict (workspace_id, normalized_key) do nothing
    returning id, normalized_key, email, website, domain, name, source, status, created_by, created_at
  ),
  late_queue_conflicts as materialized (
    select a.normalized_key
    from allowed a
    where not exists (select 1 from inserted i where i.normalized_key = a.normalized_key)
  ),
  skipped as materialized (
    select normalized_key from queue_existing
    union
    select normalized_key from history_existing
    union
    select normalized_key from team_other_before
    union
    select normalized_key from race_lost_team
    union
    select normalized_key from late_queue_conflicts
  ),
  summary as materialized (
    select
      (select count(*)::int from deduped) as row_count,
      (select count(*)::int from inserted) as inserted_count,
      ((select count(*)::int from queue_existing) + (select count(*)::int from late_queue_conflicts)) as skipped_queue_count,
      (select count(*)::int from history_existing) as skipped_history_count,
      ((select count(*)::int from team_other_before) + (select count(*)::int from race_lost_team)) as skipped_team_count,
      coalesce((select array_agg(s.normalized_key) from (select normalized_key from skipped order by normalized_key limit 500) s), array[]::text[]) as skipped_keys,
      (select count(*) > 500 from skipped) as skipped_keys_truncated
  ),
  receipt as (
    insert into public.import_chunk_receipts as icr (
      workspace_id,
      batch_id,
      chunk_key,
      row_count,
      inserted_count,
      skipped_queue_count,
      skipped_history_count,
      skipped_team_count,
      skipped_keys,
      skipped_keys_truncated,
      completed_at
    )
    select
      target_workspace,
      target_batch_id,
      clean_chunk_key,
      s.row_count,
      s.inserted_count,
      s.skipped_queue_count,
      s.skipped_history_count,
      s.skipped_team_count,
      s.skipped_keys,
      s.skipped_keys_truncated,
      now()
    from summary s
    on conflict (batch_id, chunk_key) do update
      set completed_at = excluded.completed_at
    returning
      icr.row_count,
      icr.inserted_count,
      icr.skipped_queue_count,
      icr.skipped_history_count,
      icr.skipped_team_count,
      icr.skipped_keys,
      icr.skipped_keys_truncated
  )
  select
    r.row_count,
    r.inserted_count,
    r.skipped_queue_count,
    r.skipped_history_count,
    r.skipped_team_count,
    r.skipped_keys,
    r.skipped_keys_truncated
  from receipt r;

  -- The claim and business insert above are one atomic set-based statement. Enrich the
  -- registry in a second statement so it can see the newly inserted business IDs.
  update public.team_scouted_leads t
     set first_business_id = coalesce(t.first_business_id, b.id),
         first_user_id = coalesce(t.first_user_id, b.created_by),
         last_seen_at = now(),
         email = coalesce(t.email, nullif(b.email, '')),
         website = coalesce(t.website, nullif(b.website, '')),
         domain = coalesce(t.domain, nullif(b.domain, '')),
         name = coalesce(t.name, nullif(b.name, '')),
         source = coalesce(t.source, nullif(b.source, '')),
         raw = coalesce(t.raw, '{}'::jsonb) || jsonb_build_object(
           'status', b.status,
           'bulk_imported_at', now(),
           'batch_id', target_batch_id
         )
    from public.businesses b
   where b.workspace_id = target_workspace
     and b.import_batch_id = target_batch_id
     and t.normalized_key = b.normalized_key
     and t.first_workspace_id = target_workspace
     and t.first_business_id is null;
end;
$$;

grant execute on function public.import_businesses_bulk_v2(uuid, uuid, text, jsonb, uuid, text) to authenticated;

create or replace function public.get_import_batch_progress_v2(
  target_workspace uuid,
  target_batch_id uuid
)
returns table(
  processed_count bigint,
  inserted_count bigint,
  skipped_queue_count bigint,
  skipped_history_count bigint,
  skipped_team_count bigint,
  completed_chunks bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  return query
  select
    coalesce(sum(r.row_count), 0)::bigint,
    coalesce(sum(r.inserted_count), 0)::bigint,
    coalesce(sum(r.skipped_queue_count), 0)::bigint,
    coalesce(sum(r.skipped_history_count), 0)::bigint,
    coalesce(sum(r.skipped_team_count), 0)::bigint,
    count(*)::bigint
  from public.import_chunk_receipts r
  where r.workspace_id = target_workspace
    and r.batch_id = target_batch_id;
end;
$$;

grant execute on function public.get_import_batch_progress_v2(uuid, uuid) to authenticated;

create or replace function public.finalize_import_batch_v2(
  target_workspace uuid,
  target_batch_id uuid,
  file_duplicate_count integer default 0,
  invalid_row_count integer default 0
)
returns table(
  processed_count bigint,
  inserted_count bigint,
  skipped_queue_count bigint,
  skipped_history_count bigint,
  skipped_team_count bigint,
  skipped_total bigint,
  completed_chunks bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  progress record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  select *
    into progress
  from public.get_import_batch_progress_v2(target_workspace, target_batch_id);

  update public.import_batches
     set inserted_count = coalesce(progress.inserted_count, 0)::integer,
         skipped_count = (
           coalesce(progress.skipped_queue_count, 0)
           + coalesce(progress.skipped_history_count, 0)
           + coalesce(progress.skipped_team_count, 0)
           + greatest(coalesce(file_duplicate_count, 0), 0)
           + greatest(coalesce(invalid_row_count, 0), 0)
         )::integer
   where id = target_batch_id
     and workspace_id = target_workspace;

  return query
  select
    coalesce(progress.processed_count, 0)::bigint,
    coalesce(progress.inserted_count, 0)::bigint,
    coalesce(progress.skipped_queue_count, 0)::bigint,
    coalesce(progress.skipped_history_count, 0)::bigint,
    coalesce(progress.skipped_team_count, 0)::bigint,
    (
      coalesce(progress.skipped_queue_count, 0)
      + coalesce(progress.skipped_history_count, 0)
      + coalesce(progress.skipped_team_count, 0)
      + greatest(coalesce(file_duplicate_count, 0), 0)
      + greatest(coalesce(invalid_row_count, 0), 0)
    )::bigint,
    coalesce(progress.completed_chunks, 0)::bigint;
end;
$$;

grant execute on function public.finalize_import_batch_v2(uuid, uuid, integer, integer) to authenticated;

insert into public.scout_schema_versions(version, applied_at, notes)
values (
  '10.41.0',
  now(),
  'High-speed set-based CSV import with idempotent receipts, concurrent lanes, atomic team deduplication, and resumable finalization.'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select
  'READY'::text as scout_bulk_import_status,
  '10.41.0'::text as bulk_import_contract,
  to_regclass('public.import_chunk_receipts') is not null as receipt_table_ready,
  to_regprocedure('public.import_businesses_bulk_v2(uuid,uuid,text,jsonb,uuid,text)') is not null as bulk_import_rpc_ready,
  to_regprocedure('public.get_import_batch_progress_v2(uuid,uuid)') is not null as progress_rpc_ready,
  to_regprocedure('public.finalize_import_batch_v2(uuid,uuid,integer,integer)') is not null as finalize_rpc_ready;
