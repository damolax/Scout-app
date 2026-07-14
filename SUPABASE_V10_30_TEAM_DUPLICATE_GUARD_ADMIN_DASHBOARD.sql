-- Scout v10.30
-- Team duplicate guard + admin-only Team Dashboard.
-- Run once in Supabase SQL editor after deploying v10.30. Safe to run more than once.

create extension if not exists pgcrypto;

-- Registry: one normalized prospect key can belong to the team only once.
create table if not exists public.team_scouted_leads (
  normalized_key text primary key,
  first_workspace_id uuid references public.workspaces(id) on delete set null,
  first_business_id uuid,
  first_user_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  email text,
  website text,
  domain text,
  name text,
  source text,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists team_scouted_leads_workspace_idx on public.team_scouted_leads(first_workspace_id);
create index if not exists businesses_workspace_key_idx on public.businesses(workspace_id, normalized_key);
create index if not exists businesses_key_idx on public.businesses(normalized_key);
create index if not exists sent_messages_workspace_status_idx on public.sent_messages(workspace_id, status);
create index if not exists sent_messages_workspace_from_idx on public.sent_messages(workspace_id, from_email);
create index if not exists reply_history_workspace_real_idx on public.reply_history(workspace_id, is_real_reply);

-- Backfill the team registry from existing leads. First created owner keeps the prospect.
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
select distinct on (b.normalized_key)
  b.normalized_key,
  b.workspace_id,
  b.id,
  b.created_by,
  coalesce(b.created_at, now()),
  coalesce(b.updated_at, b.created_at, now()),
  nullif(b.email, ''),
  nullif(b.website, ''),
  nullif(b.domain, ''),
  nullif(b.name, ''),
  nullif(b.source, ''),
  jsonb_build_object('backfilled_at', now(), 'status', b.status)
from public.businesses b
where nullif(trim(coalesce(b.normalized_key, '')), '') is not null
order by b.normalized_key, coalesce(b.created_at, now()) asc
on conflict (normalized_key) do nothing;

create or replace function public.record_team_scouted_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists businesses_record_team_scouted_lead on public.businesses;
create trigger businesses_record_team_scouted_lead
after insert or update of normalized_key, email, website, domain on public.businesses
for each row execute function public.record_team_scouted_lead();

create or replace function public.team_duplicate_keys(input_keys text[], target_workspace uuid default null)
returns table(normalized_key text)
language sql
security definer
set search_path = public
as $$
  select t.normalized_key
  from public.team_scouted_leads t
  where t.normalized_key = any(coalesce(input_keys, array[]::text[]))
    and (target_workspace is null or t.first_workspace_id is distinct from target_workspace);
$$;

grant execute on function public.team_duplicate_keys(text[], uuid) to authenticated;

-- Replace the category-aware import helper so CSV uploads skip prospects already claimed by another workspace.
create or replace function public.import_businesses_chunk_with_category(
  target_workspace uuid,
  target_batch_id uuid,
  input_rows jsonb,
  target_category_id uuid default null,
  target_category_name text default null
)
returns table(inserted_count int, skipped_queue_count int, skipped_history_count int, skipped_team_count int, skipped_keys text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  final_category_id uuid := target_category_id;
  final_category_name text := nullif(trim(target_category_name), '');
  team_removed int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  if final_category_id is null and final_category_name is not null then
    final_category_id := public.ensure_message_category(target_workspace, final_category_name, null);
  end if;

  if final_category_id is not null then
    select name into final_category_name from public.message_categories where id = final_category_id;
  end if;

  return query
  with incoming as (
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
  deduped as (
    select distinct on (normalized_key) * from incoming order by normalized_key
  ),
  queue_existing as (
    select d.normalized_key
    from deduped d
    join public.businesses b on b.workspace_id = target_workspace and b.normalized_key = d.normalized_key
  ),
  team_existing as (
    select d.normalized_key
    from deduped d
    join public.team_scouted_leads t on t.normalized_key = d.normalized_key
    where t.first_workspace_id is distinct from target_workspace
      and not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
  ),
  history_existing as (
    select d.normalized_key
    from deduped d
    join public.scout_history h on h.workspace_id = target_workspace and h.normalized_key = d.normalized_key
    where not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
      and not exists (select 1 from team_existing te where te.normalized_key = d.normalized_key)
  ),
  skipped as (
    select normalized_key from queue_existing
    union select normalized_key from history_existing
    union select normalized_key from team_existing
  ),
  inserted as (
    insert into public.businesses (
      workspace_id, import_batch_id, name, email, phone, website, domain, category, category_id, category_name,
      location, source, status, score, normalized_key, raw, created_by
    )
    select
      target_workspace, target_batch_id, d.name, d.email, d.phone, d.website, d.domain, d.category, d.category_id, d.category_name,
      d.location, d.source,
      case when coalesce(nullif(d.email, ''), '') <> '' then 'ready' else 'pending' end,
      case when coalesce(nullif(d.email, ''), '') <> '' then 75 else null end,
      d.normalized_key, d.raw, auth.uid()
    from deduped d
    where not exists (select 1 from skipped s where s.normalized_key = d.normalized_key)
    on conflict (workspace_id, normalized_key) do nothing
    returning normalized_key
  )
  select
    (select count(*)::int from inserted) as inserted_count,
    (select count(*)::int from queue_existing) as skipped_queue_count,
    (select count(*)::int from history_existing) as skipped_history_count,
    (select count(*)::int from team_existing) as skipped_team_count,
    coalesce((select array_agg(normalized_key) from skipped), array[]::text[]) as skipped_keys;
end;
$$;

grant execute on function public.import_businesses_chunk_with_category(uuid, uuid, jsonb, uuid, text) to authenticated;

-- Optional repair helper: removes duplicates already inserted into a workspace when another team workspace owned the prospect first.
create or replace function public.remove_team_duplicates_from_workspace(target_workspace uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  delete from public.email_research_jobs j
  using public.businesses b, public.team_scouted_leads t
  where j.business_id = b.id
    and b.workspace_id = target_workspace
    and t.normalized_key = b.normalized_key
    and t.first_workspace_id is distinct from target_workspace
    and coalesce(b.status, '') not in ('contacted','responded');

  delete from public.businesses b
  using public.team_scouted_leads t
  where b.workspace_id = target_workspace
    and t.normalized_key = b.normalized_key
    and t.first_workspace_id is distinct from target_workspace
    and coalesce(b.status, '') not in ('contacted','responded');
  get diagnostics removed = row_count;

  if removed > 0 then
    insert into public.app_notifications (workspace_id, type, title, message, entity_type, entity_id, raw)
    values (
      target_workspace,
      'team_duplicate_removed',
      'Team duplicate leads removed',
      removed::text || ' lead' || case when removed = 1 then '' else 's' end || ' already scouted by a team member and removed from this account.',
      'team_duplicate_cleanup',
      target_workspace::text || '-' || extract(epoch from now())::text,
      jsonb_build_object('removed', removed, 'target_workspace', target_workspace)
    );
  end if;

  return removed;
end;
$$;

grant execute on function public.remove_team_duplicates_from_workspace(uuid) to authenticated;

-- Admin-only dashboard helpers.
create or replace function public.is_main_scout_admin()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
  );
$$;

grant execute on function public.is_main_scout_admin() to authenticated;

create or replace function public.admin_team_dashboard()
returns table(
  user_id uuid,
  user_email text,
  workspace_id uuid,
  workspace_name text,
  lifetime_sent bigint,
  connected_senders bigint,
  total_leads bigint,
  ready_leads bigint,
  real_replies bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_main_scout_admin() then
    raise exception 'Only the main Scout admin can read Team Dashboard';
  end if;

  return query
  select
    wm.user_id,
    coalesce(u.email, p.email) as user_email,
    w.id as workspace_id,
    w.name as workspace_name,
    (select count(*) from public.sent_messages sm where sm.workspace_id = w.id and coalesce(sm.status, '') in ('sent','delivered')) as lifetime_sent,
    (select count(*) from public.gmail_accounts ga where ga.workspace_id = w.id and coalesce(ga.status, '') in ('connected','active','ready')) as connected_senders,
    (select count(*) from public.businesses b where b.workspace_id = w.id) as total_leads,
    (select count(*) from public.businesses b where b.workspace_id = w.id and coalesce(b.status, '') in ('ready','found')) as ready_leads,
    (select count(*) from public.reply_history r where r.workspace_id = w.id and coalesce(r.is_real_reply, false) = true) as real_replies,
    w.created_at
  from public.workspaces w
  left join lateral (
    select user_id, role
    from public.workspace_members wm2
    where wm2.workspace_id = w.id and wm2.approved = true
    order by case when wm2.role = 'admin' then 0 else 1 end, wm2.created_at asc
    limit 1
  ) wm on true
  left join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.id = wm.user_id
  order by w.created_at desc;
end;
$$;

grant execute on function public.admin_team_dashboard() to authenticated;

create or replace function public.admin_team_sender_dashboard()
returns table(
  user_email text,
  workspace_id uuid,
  workspace_name text,
  sender_email text,
  lifetime_sent bigint,
  last_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_main_scout_admin() then
    raise exception 'Only the main Scout admin can read Team Dashboard';
  end if;

  return query
  select
    coalesce(u.email, p.email) as user_email,
    w.id as workspace_id,
    w.name as workspace_name,
    coalesce(nullif(lower(ga.email), ''), nullif(lower(sm.from_email), ''), 'unknown') as sender_email,
    count(sm.id) filter (where coalesce(sm.status, '') in ('sent','delivered')) as lifetime_sent,
    max(sm.sent_at) as last_sent_at
  from public.workspaces w
  left join lateral (
    select user_id
    from public.workspace_members wm2
    where wm2.workspace_id = w.id and wm2.approved = true
    order by case when wm2.role = 'admin' then 0 else 1 end, wm2.created_at asc
    limit 1
  ) wm on true
  left join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.id = wm.user_id
  left join public.gmail_accounts ga on ga.workspace_id = w.id
  left join public.sent_messages sm on sm.workspace_id = w.id and (sm.gmail_account_id = ga.id or lower(sm.from_email) = lower(ga.email))
  where ga.id is not null or sm.id is not null
  group by coalesce(u.email, p.email), w.id, w.name, coalesce(nullif(lower(ga.email), ''), nullif(lower(sm.from_email), ''), 'unknown')
  order by lifetime_sent desc, sender_email asc;
end;
$$;

grant execute on function public.admin_team_sender_dashboard() to authenticated;

-- Keep the admin setup values available to user workspaces without sharing private leads/templates/senders.
do $$
declare
  admin_workspace uuid := '00000000-0000-4000-8000-000000000001';
  source_workspace public.workspaces%rowtype;
begin
  select * into source_workspace from public.workspaces where id = admin_workspace;
  if source_workspace.id is not null then
    update public.workspaces
    set app_url = source_workspace.app_url,
        render_backend_url = source_workspace.render_backend_url,
        dork_settings = coalesce(source_workspace.dork_settings, '{}'::jsonb),
        extension_settings = coalesce(source_workspace.extension_settings, '{}'::jsonb),
        updated_at = now()
    where id <> admin_workspace;
  end if;
end $$;

notify pgrst, 'reload schema';
