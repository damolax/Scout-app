-- Scout v8.36 - audience categories, category-aware imports/dorking, and admin deploy URLs

-- One category system is used for both audience buckets and template groups.
create table if not exists public.message_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

alter table public.message_categories add column if not exists description text;
alter table public.message_categories add column if not exists active boolean not null default true;
alter table public.message_categories add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.message_categories add column if not exists updated_at timestamptz not null default now();

create index if not exists message_categories_workspace_name_idx on public.message_categories(workspace_id, name);

-- Business/audience category fields.
alter table public.businesses add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table public.businesses add column if not exists category_name text;
create index if not exists businesses_workspace_category_id_idx on public.businesses(workspace_id, category_id, status, updated_at desc);

alter table public.import_batches add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table public.import_batches add column if not exists category_name text;
alter table public.import_batches add column if not exists source_mode text;

alter table public.scout_history add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table public.scout_history add column if not exists category_name text;

alter table public.daily_scouting_submissions add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table public.daily_scouting_submissions add column if not exists category_name text;

-- Scheduled jobs keep template category and audience category separate.
alter table public.message_schedules add column if not exists audience_category_id uuid references public.message_categories(id) on delete set null;
alter table public.message_schedules add column if not exists audience_category_name text;
create index if not exists message_schedules_workspace_audience_category_idx on public.message_schedules(workspace_id, audience_category_id, status, scheduled_for);

-- Workspace deploy/setup values that an admin can save for teammates/extensions.
alter table public.workspaces add column if not exists app_url text;
alter table public.workspaces add column if not exists render_backend_url text;
alter table public.workspaces add column if not exists default_audience_category_id uuid references public.message_categories(id) on delete set null;
alter table public.workspaces add column if not exists default_audience_category_name text;
alter table public.workspaces add column if not exists dork_settings jsonb not null default '{}'::jsonb;
alter table public.workspaces add column if not exists extension_settings jsonb not null default '{}'::jsonb;

-- Backfill category_name for old business rows.
update public.businesses
set category_name = coalesce(category_name, category)
where category_name is null and category is not null;

-- Keep category_name in sync when category_id is set.
create or replace function public.sync_business_category_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_id is not null then
    select name into new.category_name from public.message_categories where id = new.category_id;
  end if;
  if coalesce(new.category_name, '') <> '' and coalesce(new.category, '') = '' then
    new.category = new.category_name;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_sync_category_name on public.businesses;
create trigger businesses_sync_category_name
before insert or update of category_id, category_name, category on public.businesses
for each row execute function public.sync_business_category_name();

-- Safe grants/RLS for fresh installs.
alter table public.message_categories enable row level security;
drop policy if exists message_categories_member_all on public.message_categories;
create policy message_categories_member_all on public.message_categories
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- Helper for creating/finding a category by name from server/client flows.
create or replace function public.ensure_message_category(target_workspace uuid, category_title text, category_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := nullif(trim(category_title), '');
  category_uuid uuid;
begin
  if clean_name is null then
    return null;
  end if;
  if auth.uid() is not null and not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;
  insert into public.message_categories (workspace_id, name, description, active, created_by)
  values (target_workspace, clean_name, nullif(trim(category_description), ''), true, auth.uid())
  on conflict (workspace_id, name) do update set active = true, description = coalesce(excluded.description, public.message_categories.description), updated_at = now()
  returning id into category_uuid;
  return category_uuid;
end;
$$;

grant execute on function public.ensure_message_category(uuid, text, text) to authenticated;

-- Category-aware import helper. Existing clients can still call the old function.
create or replace function public.import_businesses_chunk_with_category(
  target_workspace uuid,
  target_batch_id uuid,
  input_rows jsonb,
  target_category_id uuid default null,
  target_category_name text default null
)
returns table(inserted_count int, skipped_queue_count int, skipped_history_count int, skipped_keys text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  final_category_id uuid := target_category_id;
  final_category_name text := nullif(trim(target_category_name), '');
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
  history_existing as (
    select d.normalized_key
    from deduped d
    join public.scout_history h on h.workspace_id = target_workspace and h.normalized_key = d.normalized_key
    where not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
  ),
  skipped as (
    select normalized_key from queue_existing union select normalized_key from history_existing
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
    coalesce((select array_agg(normalized_key) from skipped), array[]::text[]) as skipped_keys;
end;
$$;

grant execute on function public.import_businesses_chunk_with_category(uuid, uuid, jsonb, uuid, text) to authenticated;
