-- Scout v10.32 minimal, architecture-preserving migration
-- Run this file once in Supabase SQL Editor.
--
-- It does NOT repair/create workspaces during normal page loads and does NOT
-- move existing users between workspaces. It only:
--   1) restores the original v10.30 signup trigger with an optional name;
--   2) prevents optional notifications from cancelling signup;
--   3) normalizes notification entity identifiers to text;
--   4) strengthens the existing v10.30 team duplicate registry so email,
--      genuine business domain, phone and the legacy normalized key are checked;
--   5) recreates the category-aware import RPC with its expected return type;
--   6) restores the original admin dashboard RPCs.

begin;

create extension if not exists pgcrypto;

-- The original Scout notification schema stores text job IDs and UUIDs alike.
do $$
declare
  current_type text;
begin
  if to_regclass('public.app_notifications') is not null then
    select c.data_type into current_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'app_notifications'
      and c.column_name = 'entity_id';

    if current_type is not null and current_type <> 'text' then
      execute 'alter table public.app_notifications alter column entity_id type text using entity_id::text';
    end if;
  end if;
end $$;

create unique index if not exists app_notifications_dedupe_idx
on public.app_notifications(workspace_id, type, entity_type, entity_id)
where entity_type is not null and entity_id is not null;

-- Original private-workspace signup architecture. Full name is read only from
-- auth metadata entered on Create Account; it is not required in profiles or
-- requested anywhere else.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text := 'oyekunleolalekan3168@gmail.com';
  admin_workspace uuid := '00000000-0000-4000-8000-000000000001';
  new_role text;
  personal_workspace uuid;
  source_workspace public.workspaces%rowtype;
  signup_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '');
begin
  new_role := case when lower(coalesce(new.email, '')) = admin_email then 'admin' else 'member' end;

  insert into public.profiles (id, email, role, status)
  values (new.id, coalesce(new.email, ''), new_role, 'approved')
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role,
        status = 'approved',
        updated_at = now();

  insert into public.workspaces (id, name, owner_id, api_key)
  values (admin_workspace, 'Oyeola Scout Admin', case when new_role = 'admin' then new.id else null end, encode(gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

  if new_role = 'admin' then
    insert into public.workspace_members (workspace_id, user_id, role, approved)
    values (admin_workspace, new.id, 'admin', true)
    on conflict (workspace_id, user_id) do update set role = 'admin', approved = true;

    update public.workspaces
    set owner_id = new.id,
        name = coalesce(nullif(name, ''), 'Oyeola Scout Admin'),
        updated_at = now()
    where id = admin_workspace;
  else
    -- Trigger retries reuse the existing personal workspace instead of making a duplicate.
    select w.id into personal_workspace
    from public.workspaces w
    join public.workspace_members wm
      on wm.workspace_id = w.id
     and wm.user_id = new.id
     and wm.approved = true
    where w.id <> admin_workspace
    order by w.created_at asc
    limit 1;

    if personal_workspace is null then
      select * into source_workspace from public.workspaces where id = admin_workspace;

      insert into public.workspaces (
        name, owner_id, api_key, app_url, render_backend_url,
        default_audience_category_id, default_audience_category_name,
        dork_settings, extension_settings
      )
      values (
        'Scout Workspace - ' || coalesce(new.email, new.id::text),
        new.id,
        encode(gen_random_bytes(32), 'hex'),
        source_workspace.app_url,
        source_workspace.render_backend_url,
        source_workspace.default_audience_category_id,
        source_workspace.default_audience_category_name,
        coalesce(source_workspace.dork_settings, '{}'::jsonb),
        coalesce(source_workspace.extension_settings, '{}'::jsonb)
      )
      returning id into personal_workspace;
    end if;

    insert into public.workspace_members (workspace_id, user_id, role, approved)
    values (personal_workspace, new.id, 'admin', true)
    on conflict (workspace_id, user_id) do update set role = 'admin', approved = true;

    -- Notification failure must never roll back a valid Auth signup.
    begin
      insert into public.app_notifications (
        workspace_id, type, title, message, entity_type, entity_id, raw
      )
      values (
        admin_workspace,
        'new_signup',
        'New Scout signup',
        case when signup_name is not null
          then signup_name || ' (' || coalesce(new.email, 'no email') || ') created a new private Scout account.'
          else coalesce(new.email, 'A new user') || ' created a new private Scout account.'
        end,
        'auth_user',
        new.id::text,
        jsonb_build_object('name', signup_name, 'email', new.email, 'user_id', new.id, 'workspace_id', personal_workspace)
      )
      on conflict do nothing;
    exception when others then
      raise warning 'Scout signup notification skipped: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Existing v10.30 registry; one row is stored for every stable identity key.
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

create or replace function public.scout_domain_is_non_unique(input_domain text)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(trim(lower(coalesce(input_domain, ''))), '') is null then true
    else exists (
      select 1
      from unnest(array[
        'gmail.com','googlemail.com','yahoo.com','ymail.com','outlook.com','hotmail.com','live.com',
        'icloud.com','aol.com','proton.me','protonmail.com','google.com','facebook.com','instagram.com',
        'linkedin.com','youtube.com','youtu.be','tiktok.com','x.com','twitter.com','pinterest.com',
        'reddit.com','wikipedia.org','yelp.com','trustpilot.com','yellowpages.com','clutch.co','g2.com',
        'github.com','shopify.com','apps.shopify.com','wordpress.org','medium.com','quora.com'
      ]::text[]) blocked
      where lower(input_domain) = blocked or lower(input_domain) like '%.' || blocked
    )
  end;
$$;

create or replace function public.scout_business_identity_keys(
  input_normalized_key text,
  input_email text,
  input_domain text,
  input_website text,
  input_phone text,
  input_name text default null
)
returns text[]
language plpgsql
immutable
as $$
declare
  result text[] := array[]::text[];
  supplied text := lower(trim(coalesce(input_normalized_key, '')));
  clean_email text := lower(trim(coalesce(input_email, '')));
  clean_domain text := lower(trim(coalesce(input_domain, '')));
  clean_phone text := regexp_replace(coalesce(input_phone, ''), '[^+0-9]', '', 'g');
  website_host text;
  supplied_domain text;
begin
  if clean_domain = '' then
    website_host := lower(trim(coalesce(input_website, '')));
    website_host := regexp_replace(website_host, '^https?://', '', 'i');
    website_host := regexp_replace(website_host, '^www\.', '', 'i');
    website_host := split_part(split_part(website_host, '/', 1), ':', 1);
    clean_domain := website_host;
  else
    clean_domain := regexp_replace(clean_domain, '^https?://', '', 'i');
    clean_domain := regexp_replace(clean_domain, '^www\.', '', 'i');
    clean_domain := split_part(split_part(clean_domain, '/', 1), ':', 1);
  end if;

  if clean_email <> '' then result := array_append(result, 'email:' || clean_email); end if;
  if clean_domain <> '' and not public.scout_domain_is_non_unique(clean_domain) then
    result := array_append(result, 'domain:' || clean_domain);
  end if;
  if length(regexp_replace(clean_phone, '\D', '', 'g')) >= 7 then
    result := array_append(result, 'phone:' || clean_phone);
  end if;

  if supplied <> '' then
    if supplied like 'domain:%' then
      supplied_domain := substring(supplied from 8);
      if supplied_domain <> '' and not public.scout_domain_is_non_unique(supplied_domain) then
        result := array_append(result, supplied);
      end if;
    else
      result := array_append(result, supplied);
    end if;
  end if;

  if coalesce(array_length(result, 1), 0) = 0 and nullif(trim(coalesce(input_name, '')), '') is not null then
    result := array_append(result, 'name:' || lower(regexp_replace(trim(input_name), '\s+', ' ', 'g')));
  end if;

  return coalesce((select array_agg(distinct key order by key) from unnest(result) key where nullif(key, '') is not null), array[]::text[]);
end;
$$;

-- Set-based backfill: no advisory locks and no row-by-row repair loop.
with candidates as (
  select
    b.id,
    b.workspace_id,
    b.created_by,
    b.created_at,
    b.updated_at,
    b.email,
    b.website,
    b.domain,
    b.phone,
    b.name,
    b.source,
    b.status,
    unnest(public.scout_business_identity_keys(b.normalized_key, b.email, b.domain, b.website, b.phone, b.name)) as claim_key
  from public.businesses b
), first_owner as (
  select distinct on (claim_key)
    claim_key, workspace_id, id, created_by, created_at, updated_at,
    email, website, domain, name, source, status
  from candidates
  where nullif(claim_key, '') is not null
  order by claim_key, coalesce(created_at, now()) asc, id asc
)
insert into public.team_scouted_leads (
  normalized_key, first_workspace_id, first_business_id, first_user_id,
  first_seen_at, last_seen_at, email, website, domain, name, source, raw
)
select
  claim_key, workspace_id, id, created_by,
  coalesce(created_at, now()), coalesce(updated_at, created_at, now()),
  nullif(email, ''), nullif(website, ''), nullif(domain, ''), nullif(name, ''), nullif(source, ''),
  jsonb_build_object('backfilled_at', now(), 'status', status)
from first_owner
on conflict (normalized_key) do nothing;

-- Atomic first-workspace claim. Returning NULL blocks the row before it reaches
-- the second user's Businesses list. All claim keys are inserted in sorted order
-- so simultaneous uploads serialize safely on the unique primary key.
create or replace function public.claim_team_business_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  identity_keys text[];
  identity_key text;
  conflict_key text;
  conflict_workspace uuid;
begin
  identity_keys := public.scout_business_identity_keys(
    new.normalized_key, new.email, new.domain, new.website, new.phone, new.name
  );
  if coalesce(array_length(identity_keys, 1), 0) = 0 then return new; end if;

  foreach identity_key in array identity_keys loop
    insert into public.team_scouted_leads (
      normalized_key, first_workspace_id, first_business_id, first_user_id,
      first_seen_at, last_seen_at, email, website, domain, name, source, raw
    )
    values (
      identity_key, new.workspace_id, new.id, new.created_by,
      coalesce(new.created_at, now()), now(), nullif(new.email, ''), nullif(new.website, ''),
      nullif(new.domain, ''), nullif(new.name, ''), nullif(new.source, ''),
      jsonb_build_object('status', new.status, 'claimed_at', now())
    )
    on conflict (normalized_key) do nothing;
  end loop;

  select t.normalized_key, t.first_workspace_id
    into conflict_key, conflict_workspace
  from public.team_scouted_leads t
  where t.normalized_key = any(identity_keys)
    and t.first_workspace_id is not null
    and t.first_workspace_id is distinct from new.workspace_id
  order by t.normalized_key
  limit 1;

  if conflict_key is not null then
    -- Remove only tentative keys created by this blocked row.
    delete from public.team_scouted_leads t
    where t.normalized_key = any(identity_keys)
      and t.first_workspace_id = new.workspace_id
      and t.first_business_id = new.id;
    return null;
  end if;

  update public.team_scouted_leads t
  set last_seen_at = now(),
      email = coalesce(nullif(new.email, ''), t.email),
      website = coalesce(nullif(new.website, ''), t.website),
      domain = coalesce(nullif(new.domain, ''), t.domain),
      name = coalesce(nullif(new.name, ''), t.name),
      source = coalesce(nullif(new.source, ''), t.source)
  where t.normalized_key = any(identity_keys)
    and t.first_workspace_id is not distinct from new.workspace_id;

  return new;
end;
$$;

drop trigger if exists businesses_claim_team_lead_before_insert on public.businesses;
create trigger businesses_claim_team_lead_before_insert
before insert on public.businesses
for each row execute function public.claim_team_business_before_insert();

-- Keep registry metadata fresh when an owned business is enriched later.
create or replace function public.record_team_scouted_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  identity_keys text[];
begin
  identity_keys := public.scout_business_identity_keys(
    new.normalized_key, new.email, new.domain, new.website, new.phone, new.name
  );
  update public.team_scouted_leads t
  set last_seen_at = now(),
      email = coalesce(nullif(new.email, ''), t.email),
      website = coalesce(nullif(new.website, ''), t.website),
      domain = coalesce(nullif(new.domain, ''), t.domain),
      name = coalesce(nullif(new.name, ''), t.name),
      source = coalesce(nullif(new.source, ''), t.source)
  where t.normalized_key = any(identity_keys)
    and t.first_workspace_id is not distinct from new.workspace_id;
  return new;
end;
$$;

drop trigger if exists businesses_record_team_scouted_lead on public.businesses;
create trigger businesses_record_team_scouted_lead
after insert or update of normalized_key, email, website, domain, phone on public.businesses
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

-- Drop first because PostgreSQL cannot CREATE OR REPLACE a function when its
-- OUT/return table changed in an older migration.
drop function if exists public.import_businesses_chunk_with_category(uuid, uuid, jsonb, uuid, text);

create function public.import_businesses_chunk_with_category(
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
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_workspace_member(target_workspace) then raise exception 'User is not approved for this workspace'; end if;

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
      name text, email text, phone text, website text, domain text, category text,
      location text, source text, normalized_key text, raw jsonb
    )
    where nullif(trim(x.normalized_key), '') is not null
  ),
  deduped as (
    select distinct on (normalized_key) *,
      public.scout_business_identity_keys(normalized_key, email, domain, website, phone, name) as identity_keys
    from incoming order by normalized_key
  ),
  queue_existing as (
    select d.normalized_key
    from deduped d
    join public.businesses b on b.workspace_id = target_workspace and b.normalized_key = d.normalized_key
  ),
  team_existing as (
    select distinct d.normalized_key
    from deduped d
    join lateral unnest(d.identity_keys) key on true
    join public.team_scouted_leads t on t.normalized_key = key
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
  pre_skipped as (
    select normalized_key from queue_existing
    union select normalized_key from history_existing
    union select normalized_key from team_existing
  ),
  inserted as (
    insert into public.businesses (
      workspace_id, import_batch_id, name, email, phone, website, domain, category,
      category_id, category_name, location, source, status, score, normalized_key, raw, created_by
    )
    select
      target_workspace, target_batch_id, d.name, d.email, d.phone, d.website, d.domain, d.category,
      d.category_id, d.category_name, d.location, d.source,
      case when coalesce(nullif(d.email, ''), '') <> '' then 'ready' else 'pending' end,
      case when coalesce(nullif(d.email, ''), '') <> '' then 75 else null end,
      d.normalized_key, d.raw, auth.uid()
    from deduped d
    where not exists (select 1 from pre_skipped s where s.normalized_key = d.normalized_key)
    on conflict (workspace_id, normalized_key) do nothing
    returning normalized_key
  ),
  final_team_existing as (
    select distinct d.normalized_key
    from deduped d
    join lateral unnest(d.identity_keys) key on true
    join public.team_scouted_leads t on t.normalized_key = key
    where t.first_workspace_id is distinct from target_workspace
      and not exists (select 1 from inserted i where i.normalized_key = d.normalized_key)
      and not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
      and not exists (select 1 from history_existing h where h.normalized_key = d.normalized_key)
  ),
  skipped as (
    select normalized_key from queue_existing
    union select normalized_key from history_existing
    union select normalized_key from final_team_existing
  )
  select
    (select count(*)::int from inserted),
    (select count(*)::int from queue_existing),
    (select count(*)::int from history_existing),
    (select count(*)::int from final_team_existing),
    coalesce((select array_agg(normalized_key) from skipped), array[]::text[]);
end;
$$;

grant execute on function public.import_businesses_chunk_with_category(uuid, uuid, jsonb, uuid, text) to authenticated;

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

commit;
