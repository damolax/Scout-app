-- =============================================================================
-- SCOUT v10.38.0 GOOGLE-VERIFICATION APP UPGRADE
-- Run this one SQL file in the existing verification app Supabase project.
-- It adds the adaptive sender-health, three-strike restrictions, follow-up,
-- pacing, scoped-reply support fields, and required database functions.
-- It does not delete Gmail tokens, users, businesses, messages, replies, or templates.
-- =============================================================================

-- >>> BEGIN 202607170900_v10_36_adaptive_free.sql
-- Scout v10.36 Fresh Adaptive Free
-- Safe to run after the bundled historical migrations. Fresh installations use database/01_FRESH_INSTALL.sql.

create extension if not exists pgcrypto;

-- Dashboard timezone is explicit so Today/Yesterday never depend on the Vercel server timezone.
alter table if exists public.workspaces add column if not exists timezone text not null default 'UTC';
update public.workspaces set timezone = 'UTC' where timezone is null or btrim(timezone) = '';

alter table if exists public.gmail_accounts add column if not exists deployment_cap integer not null default 100;
alter table if exists public.gmail_accounts add column if not exists deployment_run_cap integer not null default 50;
alter table if exists public.gmail_accounts add column if not exists health_stage text not null default 'assessment';
alter table if exists public.gmail_accounts add column if not exists health_cap integer not null default 25;
alter table if exists public.gmail_accounts add column if not exists health_reason text;
alter table if exists public.gmail_accounts add column if not exists successful_sends bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists lifetime_sent bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists permanent_bounces bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists temporary_failures bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists provider_limit_events bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists blocked_events bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists real_replies bigint not null default 0;
alter table if exists public.gmail_accounts add column if not exists last_provider_limit_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists clean_since timestamptz not null default now();
alter table if exists public.gmail_accounts add column if not exists next_eligible_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists last_sent_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists last_health_review_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists is_paused boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists paused_reason text;

update public.gmail_accounts
set deployment_cap = greatest(1, least(300, coalesce(deployment_cap, 100))),
    deployment_run_cap = greatest(1, least(coalesce(deployment_cap, 100), coalesce(deployment_run_cap, 50))),
    daily_limit = greatest(1, least(coalesce(deployment_cap, 100), coalesce(daily_limit, deployment_cap, 100))),
    default_run_limit = greatest(1, least(coalesce(deployment_cap, 100), coalesce(default_run_limit, 50))),
    health_stage = coalesce(nullif(health_stage, ''), 'assessment'),
    health_cap = case
      when coalesce(successful_sends, 0) < 25 then least(coalesce(deployment_cap, 100), 25)
      when coalesce(successful_sends, 0) < 50 then least(coalesce(deployment_cap, 100), 50)
      when coalesce(successful_sends, 0) < 100 then least(coalesce(deployment_cap, 100), 100)
      when coalesce(successful_sends, 0) < 150 then least(coalesce(deployment_cap, 100), 150)
      else coalesce(deployment_cap, 100)
    end;

alter table if exists public.businesses add column if not exists email_verification_status text not null default 'unchecked';
alter table if exists public.businesses add column if not exists email_verification_level text;
alter table if exists public.businesses add column if not exists email_verified_at timestamptz;
alter table if exists public.businesses add column if not exists email_verification_reason text;
alter table if exists public.businesses add column if not exists email_role_label text;
alter table if exists public.businesses add column if not exists email_mx_hosts text[] not null default '{}';

create table if not exists public.email_verifications (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  domain text not null,
  status text not null,
  verification_level text not null default 'basic',
  syntax_valid boolean not null default false,
  domain_has_mx boolean not null default false,
  mx_hosts text[] not null default '{}',
  role_inbox boolean not null default false,
  role_label text,
  disposable boolean not null default false,
  reason text,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  raw jsonb not null default '{}'::jsonb,
  primary key (workspace_id, email)
);

alter table if exists public.email_verifications add column if not exists expires_at timestamptz not null default (now() + interval '7 days');

create index if not exists email_verifications_status_idx on public.email_verifications(workspace_id, status, expires_at);

create table if not exists public.sender_health_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  event_type text not null,
  reason text,
  recipient_email text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sender_health_events_account_time_idx
on public.sender_health_events(gmail_account_id, created_at desc);
create index if not exists sender_health_events_workspace_time_idx
on public.sender_health_events(workspace_id, created_at desc);

create table if not exists public.sender_send_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  status text not null default 'reserved',
  effective_daily_limit integer not null,
  used_before integer not null default 0,
  reason text,
  dispatch_at timestamptz not null default now(),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  finalized_at timestamptz,
  released_at timestamptz,
  raw jsonb not null default '{}'::jsonb
);

-- Existing installations may already have this table from an older build.
-- CREATE TABLE IF NOT EXISTS does not add missing columns, so add them before indexes/functions use them.
alter table if exists public.sender_send_reservations add column if not exists expires_at timestamptz not null default (now() + interval '10 minutes');
alter table if exists public.sender_send_reservations add column if not exists dispatch_at timestamptz not null default now();
alter table if exists public.sender_send_reservations add column if not exists reserved_at timestamptz not null default now();
alter table if exists public.sender_send_reservations add column if not exists finalized_at timestamptz;
alter table if exists public.sender_send_reservations add column if not exists released_at timestamptz;
alter table if exists public.sender_send_reservations add column if not exists raw jsonb not null default '{}'::jsonb;
update public.sender_send_reservations set expires_at = now() where expires_at is null;

create index if not exists sender_reservations_account_time_idx
on public.sender_send_reservations(gmail_account_id, reserved_at desc);
create index if not exists sender_reservations_active_idx
on public.sender_send_reservations(gmail_account_id, status, expires_at);

create table if not exists public.workspace_dispatch_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  next_dispatch_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_verifications enable row level security;
alter table public.sender_health_events enable row level security;
alter table public.sender_send_reservations enable row level security;
alter table public.workspace_dispatch_state enable row level security;

-- Verification results are isolated by workspace and contain no message bodies or OAuth secrets.
drop policy if exists email_verifications_authenticated_read on public.email_verifications;
drop policy if exists email_verifications_member_read on public.email_verifications;
create policy email_verifications_member_read on public.email_verifications
for select to authenticated using (public.is_workspace_member(workspace_id));

-- Writes are performed by server routes with the service-role key.
drop policy if exists sender_health_events_member_read on public.sender_health_events;
create policy sender_health_events_member_read on public.sender_health_events
for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists sender_reservations_member_read on public.sender_send_reservations;
create policy sender_reservations_member_read on public.sender_send_reservations
for select to authenticated using (public.is_workspace_member(workspace_id));

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
  health_limit integer;
  user_limit integer;
  effective_limit integer;
  checkpoint_limit integer;
  used_count integer;
  new_reservation uuid;
  dispatch_time timestamptz;
  workspace_next timestamptz;
  next_time timestamptz;
begin
  select * into a
  from public.gmail_accounts
  where id = target_account and workspace_id = target_workspace
  for update;

  if not found then
    return query select false, null::uuid, 'Sender account was not found.', 0, 0, 0, null::timestamptz, null::timestamptz;
    return;
  end if;

  deployment_limit := greatest(1, least(300, coalesce(a.deployment_cap, 100)));
  checkpoint_limit := case
    when coalesce(a.successful_sends, 0) < 25 then least(deployment_limit, 25)
    when coalesce(a.successful_sends, 0) < 50 then least(deployment_limit, 50)
    when coalesce(a.successful_sends, 0) < 100 then least(deployment_limit, 100)
    when coalesce(a.successful_sends, 0) < 150 then least(deployment_limit, 150)
    else deployment_limit
  end;

  health_limit := case lower(coalesce(a.health_stage, 'assessment'))
    when 'assessment' then checkpoint_limit
    when 'restricted' then least(deployment_limit, 50)
    when 'recovering' then least(deployment_limit, 75)
    when 'stable' then least(deployment_limit, 100)
    when 'established' then least(deployment_limit, 150)
    when 'healthy' then least(deployment_limit, 200)
    when 'proven' then deployment_limit
    when 'paused' then 0
    else checkpoint_limit
  end;
  health_limit := least(health_limit, greatest(0, coalesce(a.health_cap, health_limit)));
  user_limit := greatest(1, least(deployment_limit, coalesce(a.daily_limit, deployment_limit)));
  effective_limit := greatest(0, least(deployment_limit, health_limit, user_limit));

  select count(*)::integer into used_count
  from public.sender_send_reservations r
  where r.workspace_id = target_workspace
    and r.gmail_account_id = target_account
    and (
      (r.status = 'sent' and r.finalized_at >= now() - interval '24 hours')
      or (r.status = 'reserved' and r.expires_at > now())
    );

  if coalesce(a.is_paused, false)
     or lower(coalesce(a.status, '')) in ('paused', 'limit_hit', 'blocked', 'error')
     or (a.paused_until is not null and a.paused_until > now()) then
    return query select false, null::uuid,
      coalesce(a.paused_reason, a.last_error, 'Sender is paused.'),
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if a.next_eligible_at is not null and a.next_eligible_at > now() then
    return query select false, null::uuid, 'Sender cooldown is still active.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if effective_limit <= 0 or used_count >= effective_limit then
    return query select false, null::uuid, 'Sender reached its effective rolling 24-hour limit.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  insert into public.workspace_dispatch_state(workspace_id, next_dispatch_at)
  values (target_workspace, now())
  on conflict (workspace_id) do nothing;

  select s.next_dispatch_at into workspace_next
  from public.workspace_dispatch_state s
  where s.workspace_id = target_workspace
  for update;

  dispatch_time := greatest(now(), coalesce(workspace_next, now()));
  if dispatch_time > now() + interval '45 seconds' then
    return query select false, null::uuid,
      'Workspace dispatch slots are full for this cron cycle. Scout will retry automatically.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), dispatch_time, a.next_eligible_at;
    return;
  end if;

  update public.workspace_dispatch_state
  set next_dispatch_at = dispatch_time + interval '5 seconds', updated_at = now()
  where workspace_id = target_workspace;

  next_time := dispatch_time + make_interval(secs => (90 + floor(random() * 121))::integer);
  insert into public.sender_send_reservations(
    workspace_id, gmail_account_id, status, effective_daily_limit, used_before, dispatch_at, expires_at, raw
  ) values (
    target_workspace, target_account, 'reserved', effective_limit, used_count, dispatch_time,
    dispatch_time + interval '10 minutes', coalesce(reservation_raw, '{}'::jsonb)
  ) returning id into new_reservation;

  update public.gmail_accounts
  set next_eligible_at = next_time,
      health_cap = health_limit,
      updated_at = now()
  where id = target_account and workspace_id = target_workspace;

  return query select true, new_reservation, 'Reserved.', effective_limit, used_count,
    greatest(0, effective_limit - used_count - 1), dispatch_time, next_time;
end;
$$;

create or replace function public.finalize_sender_send(
  target_reservation uuid,
  target_recipient text default null,
  event_raw jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sender_send_reservations%rowtype;
begin
  update public.sender_send_reservations
  set status = 'sent', finalized_at = now(), raw = coalesce(raw, '{}'::jsonb) || coalesce(event_raw, '{}'::jsonb)
  where id = target_reservation and status = 'reserved'
  returning * into r;

  if not found then return false; end if;

  update public.gmail_accounts
  set successful_sends = coalesce(successful_sends, 0) + 1,
      lifetime_sent = coalesce(lifetime_sent, 0) + 1,
      sent_today = coalesce(sent_today, 0) + 1,
      last_sent_at = now(),
      last_error = null,
      updated_at = now()
  where id = r.gmail_account_id and workspace_id = r.workspace_id;

  insert into public.sender_health_events(
    workspace_id, gmail_account_id, event_type, recipient_email, raw
  ) values (
    r.workspace_id, r.gmail_account_id, 'send_success', nullif(lower(trim(target_recipient)), ''), coalesce(event_raw, '{}'::jsonb)
  );
  return true;
end;
$$;

create or replace function public.release_sender_send(
  target_reservation uuid,
  release_reason text default null,
  event_raw jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sender_send_reservations%rowtype;
begin
  update public.sender_send_reservations
  set status = 'released', released_at = now(), reason = release_reason,
      raw = coalesce(raw, '{}'::jsonb) || coalesce(event_raw, '{}'::jsonb)
  where id = target_reservation and status = 'reserved'
  returning * into r;
  if not found then return false; end if;
  return true;
end;
$$;

create or replace function public.refresh_sender_today_counts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.gmail_accounts a
  set sent_today = coalesce(x.cnt, 0), updated_at = now()
  from (
    select ga.id,
      count(r.id) filter (where r.status = 'sent' and r.finalized_at >= date_trunc('day', now()))::integer as cnt
    from public.gmail_accounts ga
    left join public.sender_send_reservations r on r.gmail_account_id = ga.id
    group by ga.id
  ) x
  where a.id = x.id and a.sent_today is distinct from coalesce(x.cnt, 0);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.reserve_sender_send(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_sender_send(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_sender_send(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.refresh_sender_today_counts() from public, anon, authenticated;
grant execute on function public.reserve_sender_send(uuid, uuid, jsonb) to service_role;
grant execute on function public.finalize_sender_send(uuid, text, jsonb) to service_role;
grant execute on function public.release_sender_send(uuid, text, jsonb) to service_role;
grant execute on function public.refresh_sender_today_counts() to service_role;

notify pgrst, 'reload schema';

-- Fresh-deployment ownership: the first person who signs up becomes the installation owner.
-- This makes the same ZIP deployable by different team members without editing a hard-coded email in SQL.
create table if not exists public.scout_installation (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.scout_installation(singleton) values (true) on conflict (singleton) do nothing;

create or replace function public.is_main_scout_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$
  select exists (
    select 1 from public.scout_installation i
    where i.singleton = true and i.owner_user_id = auth.uid()
  );
$$;
revoke all on function public.is_main_scout_admin() from public, anon;
grant execute on function public.is_main_scout_admin() to authenticated, service_role;

create or replace function public.provision_scout_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_admin_workspace constant uuid := '00000000-0000-4000-8000-000000000001';
  v_email text;
  v_full_name text;
  v_owner_user_id uuid;
  v_is_owner boolean;
  v_workspace_id uuid;
  v_admin_source public.workspaces%rowtype;
begin
  select lower(coalesce(u.email, '')),
         nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '')
  into v_email, v_full_name
  from auth.users u where u.id = p_user_id;
  if not found then raise exception 'Scout user % does not exist in auth.users', p_user_id; end if;

  perform pg_advisory_xact_lock(hashtext('scout_installation_owner'));
  insert into public.scout_installation(singleton) values (true) on conflict (singleton) do nothing;
  select owner_user_id into v_owner_user_id from public.scout_installation where singleton = true for update;
  if v_owner_user_id is null then
    update public.scout_installation
    set owner_user_id = p_user_id, owner_email = v_email, updated_at = now()
    where singleton = true;
    v_owner_user_id := p_user_id;
  end if;
  v_is_owner := v_owner_user_id = p_user_id;

  insert into public.profiles(id, email, full_name, role, status)
  values (p_user_id, v_email, v_full_name, case when v_is_owner then 'admin' else 'member' end, 'approved')
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      role = excluded.role,
      status = 'approved',
      updated_at = now();

  insert into public.workspaces(id, name, owner_id)
  values (v_admin_workspace, 'Scout Administration', case when v_is_owner then p_user_id else null end)
  on conflict (id) do update
  set owner_id = case when v_is_owner then p_user_id else public.workspaces.owner_id end,
      updated_at = now();

  if v_is_owner then
    v_workspace_id := v_admin_workspace;
    insert into public.workspace_members(workspace_id, user_id, role, approved)
    values (v_workspace_id, p_user_id, 'admin', true)
    on conflict (workspace_id, user_id) do update set role = 'admin', approved = true;
  else
    delete from public.workspace_members where user_id = p_user_id and workspace_id = v_admin_workspace;

    select w.id into v_workspace_id
    from public.workspaces w
    where w.owner_id = p_user_id and w.id <> v_admin_workspace
    order by w.created_at asc limit 1;

    if v_workspace_id is null then
      select * into v_admin_source from public.workspaces where id = v_admin_workspace;
      insert into public.workspaces(
        name, owner_id, app_url, render_backend_url,
        default_audience_category_id, default_audience_category_name,
        dork_settings, extension_settings
      ) values (
        'Scout Workspace - ' || coalesce(v_email, p_user_id::text),
        p_user_id,
        v_admin_source.app_url,
        v_admin_source.render_backend_url,
        v_admin_source.default_audience_category_id,
        v_admin_source.default_audience_category_name,
        coalesce(v_admin_source.dork_settings, '{}'::jsonb),
        coalesce(v_admin_source.extension_settings, '{}'::jsonb)
      ) returning id into v_workspace_id;
    end if;

    insert into public.workspace_members(workspace_id, user_id, role, approved)
    values (v_workspace_id, p_user_id, 'member', true)
    on conflict (workspace_id, user_id) do update set role = 'member', approved = true;
  end if;

  return v_workspace_id;
end;
$$;
revoke all on function public.provision_scout_user(uuid) from public, anon, authenticated;
grant execute on function public.provision_scout_user(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_workspace_id uuid;
  v_owner_user_id uuid;
  v_full_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '');
begin
  v_workspace_id := public.provision_scout_user(new.id);
  select owner_user_id into v_owner_user_id from public.scout_installation where singleton = true;
  if new.id is distinct from v_owner_user_id then
    begin
      insert into public.app_notifications(
        workspace_id, type, title, message, entity_type, entity_id, raw
      ) values (
        '00000000-0000-4000-8000-000000000001',
        'new_signup',
        'New Scout signup',
        case when v_full_name is not null
          then v_full_name || ' (' || coalesce(new.email, 'no email') || ') created a Scout account.'
          else coalesce(new.email, 'A new user') || ' created a Scout account.' end,
        'auth_user', new.id::text,
        jsonb_build_object('name', v_full_name, 'email', new.email, 'user_id', new.id, 'workspace_id', v_workspace_id)
      ) on conflict do nothing;
    exception when others then
      raise warning 'Scout signup notification skipped: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_scout_workspace()
returns table (
  id uuid,
  name text,
  api_key text,
  app_url text,
  render_backend_url text,
  default_audience_category_id uuid,
  default_audience_category_name text,
  dork_settings jsonb,
  extension_settings jsonb,
  email_signature_text text,
  email_signature_html text,
  email_logo_url text
)
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$
  select w.id, w.name, w.api_key, w.app_url, w.render_backend_url,
         w.default_audience_category_id, w.default_audience_category_name,
         w.dork_settings, w.extension_settings,
         w.email_signature_text, w.email_signature_html, w.email_logo_url
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  left join public.scout_installation i on i.singleton = true
  where wm.user_id = auth.uid()
  order by
    case when i.owner_user_id = wm.user_id and w.id = '00000000-0000-4000-8000-000000000001' then 0
         when w.owner_id = wm.user_id then 1 else 2 end,
    wm.created_at asc
  limit 1;
$$;
revoke all on function public.current_scout_workspace() from public, anon;
grant execute on function public.current_scout_workspace() to authenticated, service_role;

-- If this migration is applied to an installation that already has users but no owner record,
-- the earliest Auth account becomes owner and all accounts are re-provisioned without deleting data.
do $$
declare
  v_first uuid;
  r record;
begin
  if (select owner_user_id is null from public.scout_installation where singleton = true) then
    select id into v_first from auth.users order by created_at asc limit 1;
    if v_first is not null then
      update public.scout_installation i
      set owner_user_id = v_first,
          owner_email = (select lower(email) from auth.users where id = v_first),
          updated_at = now()
      where i.singleton = true;
    end if;
  end if;
  for r in select id from auth.users order by created_at asc loop
    perform public.provision_scout_user(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- <<< END 202607170900_v10_36_adaptive_free.sql

select pg_notify('pgrst', 'reload schema');

-- >>> BEGIN v10.36.2 SIMPLE INDEPENDENT DEPLOYMENT
-- Every account has equal access to its own private workspace. There is no global
-- administrator, no approval gate and no special owner email.
begin;

create or replace function public.is_main_scout_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$ select false; $$;
revoke all on function public.is_main_scout_admin() from public, anon;
grant execute on function public.is_main_scout_admin() to authenticated, service_role;

drop function if exists public.admin_team_sender_dashboard();
drop function if exists public.admin_team_dashboard();

create or replace function public.provision_scout_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_email text;
  v_full_name text;
  v_workspace_id uuid;
begin
  select lower(coalesce(u.email, '')),
         nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '')
  into v_email, v_full_name
  from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception 'Scout user % does not exist in auth.users', p_user_id;
  end if;

  insert into public.profiles(id, email, full_name, role, status)
  values (p_user_id, v_email, v_full_name, 'member', 'approved')
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      role = 'member',
      status = 'approved',
      updated_at = now();

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_id = p_user_id
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    select w.id into v_workspace_id
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = p_user_id
      and (w.owner_id is null or w.owner_id = p_user_id)
    order by wm.created_at asc
    limit 1;
  end if;

  if v_workspace_id is null then
    insert into public.workspaces(name, owner_id)
    values ('Scout - ' || coalesce(v_full_name, nullif(v_email, ''), p_user_id::text), p_user_id)
    returning id into v_workspace_id;
  else
    update public.workspaces
    set owner_id = p_user_id,
        updated_at = now()
    where id = v_workspace_id
      and owner_id is null;
  end if;

  insert into public.workspace_members(workspace_id, user_id, role, approved)
  values (v_workspace_id, p_user_id, 'member', true)
  on conflict (workspace_id, user_id) do update
  set role = 'member', approved = true;

  update public.workspace_members
  set role = 'member', approved = true
  where user_id = p_user_id;

  return v_workspace_id;
end;
$$;
revoke all on function public.provision_scout_user(uuid) from public, anon, authenticated;
grant execute on function public.provision_scout_user(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
begin
  perform public.provision_scout_user(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_scout_workspace()
returns table (
  id uuid,
  name text,
  api_key text,
  app_url text,
  render_backend_url text,
  default_audience_category_id uuid,
  default_audience_category_name text,
  dork_settings jsonb,
  extension_settings jsonb,
  email_signature_text text,
  email_signature_html text,
  email_logo_url text
)
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$
  select w.id, w.name, w.api_key, w.app_url, w.render_backend_url,
         w.default_audience_category_id, w.default_audience_category_name,
         w.dork_settings, w.extension_settings,
         w.email_signature_text, w.email_signature_html, w.email_logo_url
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
  order by case when w.owner_id = wm.user_id then 0 else 1 end, wm.created_at asc
  limit 1;
$$;
revoke all on function public.current_scout_workspace() from public, anon;
grant execute on function public.current_scout_workspace() to authenticated, service_role;

update public.profiles set role = 'member', status = 'approved', updated_at = now();
update public.workspace_members set role = 'member', approved = true;

do $$
declare r record;
begin
  for r in select id from auth.users order by created_at asc loop
    perform public.provision_scout_user(r.id);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
-- <<< END v10.36.2 SIMPLE INDEPENDENT DEPLOYMENT

-- v10.36.2 fixed sender defaults for every independent deployment.
alter table if exists public.gmail_accounts alter column deployment_cap set default 250;
alter table if exists public.gmail_accounts alter column deployment_run_cap set default 250;
alter table if exists public.gmail_accounts alter column daily_limit set default 250;
alter table if exists public.gmail_accounts alter column default_run_limit set default 250;

update public.gmail_accounts
set deployment_cap = 250,
    deployment_run_cap = 250,
    daily_limit = greatest(1, least(250, coalesce(daily_limit, 250))),
    default_run_limit = greatest(1, least(250, coalesce(default_run_limit, 250))),
    health_cap = greatest(0, least(250, coalesce(health_cap, 25))),
    updated_at = now();

notify pgrst, 'reload schema';

-- v10.36.7 installer repair: table-returning RPCs are safely dropped before replacement.

-- >>> BEGIN SCOUT_V10_37_FINAL_FIRST_INSTALL_PATCH
-- Final first-install rules: 250 hard ceiling, protected temporary safety resume,
-- 90–210 seconds between sends from the same Gmail and 3–6 seconds between
-- different Gmail accounts in the same workspace.

alter table if exists public.gmail_accounts add column if not exists pause_kind text;
alter table if exists public.gmail_accounts add column if not exists safety_override_until timestamptz;
alter table if exists public.gmail_accounts add column if not exists safety_override_warning text;
alter table if exists public.gmail_accounts add column if not exists safety_override_acknowledged_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists last_stage_change_at timestamptz;

alter table if exists public.gmail_accounts alter column deployment_cap set default 250;
alter table if exists public.gmail_accounts alter column deployment_run_cap set default 250;

update public.gmail_accounts
set deployment_cap = 250,
    deployment_run_cap = 250,
    daily_limit = greatest(1, least(250, coalesce(daily_limit, 250))),
    default_run_limit = greatest(1, least(250, coalesce(default_run_limit, 50))),
    health_cap = greatest(0, least(250, coalesce(health_cap, 25))),
    updated_at = now();

drop function if exists public.reserve_sender_send(uuid, uuid, jsonb);

create function public.reserve_sender_send(
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
  health_limit integer;
  user_limit integer;
  effective_limit integer;
  checkpoint_limit integer;
  used_count integer;
  new_reservation uuid;
  dispatch_time timestamptz;
  workspace_next timestamptz;
  next_time timestamptz;
  workspace_gap_seconds integer;
  override_active boolean;
  automatic_pause boolean;
  timed_pause_expired boolean;
begin
  select * into a
  from public.gmail_accounts
  where id = target_account and workspace_id = target_workspace
  for update;

  if not found then
    return query select false, null::uuid, 'Sender account was not found.', 0, 0, 0, null::timestamptz, null::timestamptz;
    return;
  end if;

  deployment_limit := 250;
  override_active := coalesce(a.pause_kind, '') <> ''
    and coalesce(a.pause_kind, '') <> 'manual'
    and a.safety_override_until is not null
    and a.safety_override_until > now();
  automatic_pause := coalesce(a.pause_kind, '') <> '' and coalesce(a.pause_kind, '') <> 'manual';
  timed_pause_expired := automatic_pause
    and coalesce(a.pause_kind, '') <> 'permanent_bounce'
    and a.paused_until is not null
    and a.paused_until <= now();

  -- Timed automatic pauses recover automatically. Permanent-bounce and manual
  -- pauses require a person to act. Temporary override never deletes the warning.
  if timed_pause_expired and not override_active then
    update public.gmail_accounts
    set is_paused = false,
        status = 'connected',
        pause_kind = null,
        paused_until = null,
        paused_reason = null,
        safety_override_until = null,
        safety_override_warning = null,
        health_stage = 'recovering',
        health_cap = least(deployment_limit, 75),
        health_reason = 'The timed safety pause ended. Scout restarted this sender in Recovering stage.',
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
    automatic_pause := false;
  elsif automatic_pause and not override_active then
    update public.gmail_accounts
    set is_paused = true,
        status = case when pause_kind = 'provider_limit' then 'limit_hit' else 'paused' end,
        safety_override_until = null,
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
  end if;

  checkpoint_limit := case
    when coalesce(a.successful_sends, 0) < 25 then least(deployment_limit, 25)
    when coalesce(a.successful_sends, 0) < 50 then least(deployment_limit, 50)
    when coalesce(a.successful_sends, 0) < 100 then least(deployment_limit, 100)
    when coalesce(a.successful_sends, 0) < 150 then least(deployment_limit, 150)
    else deployment_limit
  end;

  health_limit := case lower(coalesce(a.health_stage, 'assessment'))
    when 'assessment' then checkpoint_limit
    when 'restricted' then least(deployment_limit, 50)
    when 'recovering' then least(deployment_limit, 75)
    when 'stable' then least(deployment_limit, 100)
    when 'established' then least(deployment_limit, 150)
    when 'healthy' then least(deployment_limit, 200)
    when 'proven' then deployment_limit
    when 'paused' then case when override_active then least(deployment_limit, 50) else 0 end
    else checkpoint_limit
  end;
  health_limit := least(health_limit, greatest(0, coalesce(a.health_cap, health_limit)));
  if override_active then health_limit := least(deployment_limit, greatest(1, least(50, health_limit))); end if;
  user_limit := greatest(1, least(deployment_limit, coalesce(a.daily_limit, deployment_limit)));
  effective_limit := greatest(0, least(deployment_limit, health_limit, user_limit));

  select count(*)::integer into used_count
  from public.sender_send_reservations r
  where r.workspace_id = target_workspace
    and r.gmail_account_id = target_account
    and (
      (r.status = 'sent' and r.finalized_at >= now() - interval '24 hours')
      or (r.status = 'reserved' and r.expires_at > now())
    );

  if coalesce(a.pause_kind, '') = 'manual' or (coalesce(a.is_paused, false) and not override_active)
     or (lower(coalesce(a.status, '')) in ('paused', 'limit_hit', 'blocked', 'error') and not override_active)
     or (automatic_pause and not override_active) then
    return query select false, null::uuid,
      coalesce(a.paused_reason, a.health_reason, a.last_error, 'Sender is paused.'),
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if a.next_eligible_at is not null and a.next_eligible_at > now() then
    return query select false, null::uuid, 'Sender cooldown is still active.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if effective_limit <= 0 or used_count >= effective_limit then
    return query select false, null::uuid, 'Sender reached its effective rolling 24-hour limit.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  insert into public.workspace_dispatch_state(workspace_id, next_dispatch_at)
  values (target_workspace, now())
  on conflict (workspace_id) do nothing;

  select s.next_dispatch_at into workspace_next
  from public.workspace_dispatch_state s
  where s.workspace_id = target_workspace
  for update;

  dispatch_time := greatest(now(), coalesce(workspace_next, now()));
  if dispatch_time > now() + interval '45 seconds' then
    return query select false, null::uuid,
      'Workspace dispatch slots are full for this worker cycle. Scout will retry automatically.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), dispatch_time, a.next_eligible_at;
    return;
  end if;

  workspace_gap_seconds := 3 + floor(random() * 4)::integer;
  update public.workspace_dispatch_state
  set next_dispatch_at = dispatch_time + make_interval(secs => workspace_gap_seconds), updated_at = now()
  where workspace_id = target_workspace;

  next_time := dispatch_time + make_interval(secs => (90 + floor(random() * 121))::integer);
  insert into public.sender_send_reservations(
    workspace_id, gmail_account_id, status, effective_daily_limit, used_before, dispatch_at, expires_at, raw
  ) values (
    target_workspace, target_account, 'reserved', effective_limit, used_count, dispatch_time,
    dispatch_time + interval '10 minutes', coalesce(reservation_raw, '{}'::jsonb)
  ) returning id into new_reservation;

  update public.gmail_accounts
  set next_eligible_at = next_time,
      health_cap = health_limit,
      updated_at = now()
  where id = target_account and workspace_id = target_workspace;

  return query select true, new_reservation, 'Reserved.', effective_limit, used_count,
    greatest(0, effective_limit - used_count - 1), dispatch_time, next_time;
end;
$$;

revoke all on function public.reserve_sender_send(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_sender_send(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

-- Final visible confirmation. A successful run ends with one row saying READY.
select
  'READY'::text as scout_database_status,
  250::integer as hard_daily_ceiling,
  '90-210 seconds'::text as same_gmail_delay,
  '3-6 seconds'::text as different_gmail_delay,
  (select count(*) from information_schema.tables where table_schema = 'public')::integer as public_tables_found;
-- <<< END SCOUT_V10_37_FINAL_FIRST_INSTALL_PATCH

-- Secure the due-follow-up functions so an authenticated user can only query
-- their own workspace. Drop dependent functions first so this also upgrades an
-- older Scout database without the PostgreSQL 42P13 return-type error.
drop function if exists public.count_due_followups(uuid, text);
drop function if exists public.get_due_followups(uuid, integer, text);

create function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100,
  followup_segment text default 'all_unanswered'
)
returns table (
  business_id uuid,
  business_name text,
  to_email text,
  website text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid,
  followup_segment text,
  reply_state text,
  last_auto_reply_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with access_guard as (
    select 1 as allowed
    where auth.role() = 'service_role' or public.is_workspace_member(target_workspace)
  ), last_sent as (
    select distinct on (sm.business_id)
      sm.business_id,
      sm.sent_at,
      sm.subject,
      sm.template_id,
      sm.gmail_account_id
    from public.sent_messages sm
    cross join access_guard
    where sm.workspace_id = target_workspace
      and sm.status in ('sent', 'delivered', 'dry_run')
    order by sm.business_id, sm.sent_at desc nulls last
  ), reply_flags as (
    select
      rh.business_id,
      bool_or(coalesce(rh.is_real_reply, false)) as has_real_reply,
      bool_or(coalesce(rh.is_auto_reply, false)) as has_auto_reply,
      bool_or(coalesce(rh.is_delivery_failure, false) or coalesce(rh.is_blocked, false)) as has_bad_inbox,
      max(case when coalesce(rh.is_auto_reply, false) then rh.received_at else null end) as auto_reply_at
    from public.reply_history rh
    cross join access_guard
    where rh.workspace_id = target_workspace
    group by rh.business_id
  )
  select
    b.id as business_id,
    coalesce(b.name, '') as business_name,
    coalesce(b.email, '') as to_email,
    coalesce(b.website, '') as website,
    ls.sent_at as last_sent_at,
    ls.subject as last_subject,
    ls.template_id,
    ls.gmail_account_id,
    case when coalesce(rf.has_auto_reply, false) then 'auto_reply' else 'no_reply' end as followup_segment,
    case when coalesce(rf.has_auto_reply, false) then 'auto_reply' else 'no_reply' end as reply_state,
    rf.auto_reply_at as last_auto_reply_at
  from public.businesses b
  join last_sent ls on ls.business_id = b.id
  left join reply_flags rf on rf.business_id = b.id
  cross join access_guard
  where b.workspace_id = target_workspace
    and coalesce(b.email, '') <> ''
    and coalesce(b.status, '') not in ('responded', 'bad_inbox', 'bounced', 'no_inbox', 'blocked', 'invalid', 'duplicate', 'archived')
    and ls.sent_at <= now() - interval '72 hours'
    and coalesce(rf.has_real_reply, false) = false
    and coalesce(rf.has_bad_inbox, false) = false
    and (
      $3 in ('all', 'all_unanswered', '')
      or ($3 = 'no_reply' and coalesce(rf.has_auto_reply, false) = false)
      or ($3 = 'auto_reply' and coalesce(rf.has_auto_reply, false) = true)
    )
  order by ls.sent_at asc
  limit greatest(1, limit_rows);
$$;

revoke all on function public.get_due_followups(uuid, integer, text) from public, anon;
grant execute on function public.get_due_followups(uuid, integer, text) to authenticated, service_role;

create function public.count_due_followups(
  target_workspace uuid,
  followup_segment text default 'all_unanswered'
)
returns bigint
language sql
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role' or public.is_workspace_member(target_workspace)
    then (select count(*) from public.get_due_followups(target_workspace, 2147483647, followup_segment))
    else 0::bigint
  end;
$$;

revoke all on function public.count_due_followups(uuid, text) from public, anon;
grant execute on function public.count_due_followups(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

select
  'READY'::text as scout_database_status,
  250::integer as hard_daily_ceiling,
  '90-210 seconds'::text as same_gmail_delay,
  '3-6 seconds'::text as different_gmail_delay,
  to_regprocedure('public.count_due_followups(uuid,text)') is not null as all_followups_ready;

alter table if exists public.team_scouted_leads enable row level security;
notify pgrst, 'reload schema';

-- >>> SCOUT V10.38 FINAL SENDER RECOVERY + THREE-STRIKE PATCH
alter table if exists public.gmail_accounts add column if not exists safety_override_active boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists pause_issue_key text;
alter table if exists public.gmail_accounts add column if not exists pause_issue_count integer not null default 0;
alter table if exists public.gmail_accounts add column if not exists pause_issue_window_started_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists pause_issue_window_ends_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists pause_issue_last_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists hard_restriction_active boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists hard_restricted_until timestamptz;
alter table if exists public.gmail_accounts add column if not exists hard_restriction_reason text;
alter table if exists public.gmail_accounts add column if not exists hard_restriction_count integer not null default 0;
alter table if exists public.gmail_accounts add column if not exists connection_status text not null default 'not_checked';
alter table if exists public.gmail_accounts add column if not exists connection_verified_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists connection_error text;

create index if not exists gmail_accounts_hard_restriction_idx
  on public.gmail_accounts(workspace_id, hard_restriction_active, hard_restricted_until);

update public.gmail_accounts
set safety_override_active = false
where safety_override_active is null;

drop function if exists public.reserve_sender_send(uuid, uuid, jsonb);

create function public.reserve_sender_send(
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
  health_limit integer;
  user_limit integer;
  effective_limit integer;
  checkpoint_limit integer;
  used_count integer;
  new_reservation uuid;
  dispatch_time timestamptz;
  workspace_next timestamptz;
  next_time timestamptz;
  workspace_gap_seconds integer;
  override_active boolean;
  automatic_pause boolean;
  timed_pause_expired boolean;
  hard_active boolean;
begin
  select * into a
  from public.gmail_accounts
  where id = target_account and workspace_id = target_workspace
  for update;

  if not found then
    return query select false, null::uuid, 'Sender account was not found.', 0, 0, 0, null::timestamptz, null::timestamptz;
    return;
  end if;

  deployment_limit := 250;
  override_active := coalesce(a.safety_override_active, false)
    and coalesce(a.pause_kind, '') <> ''
    and coalesce(a.pause_kind, '') <> 'manual';
  hard_active := coalesce(a.hard_restriction_active, false)
    and (a.hard_restricted_until is null or a.hard_restricted_until > now());

  if coalesce(a.hard_restriction_active, false)
     and a.hard_restricted_until is not null
     and a.hard_restricted_until <= now() then
    update public.gmail_accounts
    set hard_restriction_active = false,
        hard_restricted_until = null,
        hard_restriction_reason = null,
        pause_issue_key = null,
        pause_issue_count = 0,
        pause_issue_window_started_at = null,
        pause_issue_window_ends_at = null,
        pause_kind = null,
        paused_until = null,
        paused_reason = null,
        safety_override_active = false,
        safety_override_until = null,
        safety_override_warning = null,
        is_paused = false,
        status = 'connected',
        health_stage = 'recovering',
        health_cap = least(deployment_limit, 25),
        health_reason = 'The hard restriction ended. Scout restarted this Gmail in Recovering stage at 25/day.',
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
    hard_active := false;
    override_active := false;
  end if;

  if hard_active then
    return query select false, null::uuid,
      coalesce(a.hard_restriction_reason, a.paused_reason, 'This Gmail is hard-restricted.'),
      0, 0, 0, null::timestamptz, a.next_eligible_at;
    return;
  end if;

  automatic_pause := coalesce(a.pause_kind, '') <> '' and coalesce(a.pause_kind, '') <> 'manual';
  timed_pause_expired := automatic_pause
    and coalesce(a.pause_kind, '') <> 'permanent_bounce'
    and a.paused_until is not null
    and a.paused_until <= now();

  if timed_pause_expired and not override_active then
    update public.gmail_accounts
    set is_paused = false,
        status = 'connected',
        pause_kind = null,
        paused_until = null,
        paused_reason = null,
        safety_override_active = false,
        safety_override_until = null,
        safety_override_warning = null,
        health_stage = 'recovering',
        health_cap = least(deployment_limit, 50),
        health_reason = 'The timed safety pause ended. Scout restarted this Gmail in Recovering stage at 50/day.',
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
    automatic_pause := false;
  elsif automatic_pause and not override_active then
    update public.gmail_accounts
    set is_paused = true,
        health_cap = 0,
        status = case when pause_kind = 'provider_limit' then 'limit_hit' else 'paused' end,
        safety_override_active = false,
        safety_override_until = null,
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
  elsif override_active then
    update public.gmail_accounts
    set is_paused = false,
        status = 'connected',
        health_stage = 'recovering',
        health_cap = least(deployment_limit, 50),
        updated_at = now()
    where id = target_account and workspace_id = target_workspace
    returning * into a;
  end if;

  checkpoint_limit := case
    when coalesce(a.successful_sends, 0) < 25 then least(deployment_limit, 25)
    when coalesce(a.successful_sends, 0) < 50 then least(deployment_limit, 50)
    when coalesce(a.successful_sends, 0) < 100 then least(deployment_limit, 100)
    when coalesce(a.successful_sends, 0) < 150 then least(deployment_limit, 150)
    else deployment_limit
  end;

  health_limit := case lower(coalesce(a.health_stage, 'assessment'))
    when 'assessment' then checkpoint_limit
    when 'restricted' then least(deployment_limit, 50)
    when 'recovering' then least(deployment_limit, 75)
    when 'stable' then least(deployment_limit, 100)
    when 'established' then least(deployment_limit, 150)
    when 'healthy' then least(deployment_limit, 200)
    when 'proven' then deployment_limit
    when 'paused' then case when override_active then least(deployment_limit, 50) else 0 end
    else checkpoint_limit
  end;
  health_limit := least(health_limit, greatest(0, coalesce(a.health_cap, health_limit)));
  if override_active then health_limit := least(deployment_limit, 50); end if;
  user_limit := greatest(1, least(deployment_limit, coalesce(a.daily_limit, deployment_limit)));
  effective_limit := greatest(0, least(deployment_limit, health_limit, user_limit));

  select count(*)::integer into used_count
  from public.sender_send_reservations r
  where r.workspace_id = target_workspace
    and r.gmail_account_id = target_account
    and (
      (r.status = 'sent' and r.finalized_at >= now() - interval '24 hours')
      or (r.status = 'reserved' and r.expires_at > now())
    );

  if coalesce(a.pause_kind, '') = 'manual'
     or (coalesce(a.is_paused, false) and not override_active)
     or (lower(coalesce(a.status, '')) in ('paused', 'limit_hit', 'blocked', 'error') and not override_active)
     or (automatic_pause and not override_active) then
    return query select false, null::uuid,
      coalesce(a.paused_reason, a.health_reason, a.last_error, 'Sender is paused.'),
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if a.next_eligible_at is not null and a.next_eligible_at > now() then
    return query select false, null::uuid, 'Sender cooldown is still active.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  if effective_limit <= 0 or used_count >= effective_limit then
    return query select false, null::uuid, 'Sender reached its effective rolling 24-hour limit.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), null::timestamptz, a.next_eligible_at;
    return;
  end if;

  insert into public.workspace_dispatch_state(workspace_id, next_dispatch_at)
  values (target_workspace, now())
  on conflict (workspace_id) do nothing;

  select s.next_dispatch_at into workspace_next
  from public.workspace_dispatch_state s
  where s.workspace_id = target_workspace
  for update;

  dispatch_time := greatest(now(), coalesce(workspace_next, now()));
  if dispatch_time > now() + interval '45 seconds' then
    return query select false, null::uuid,
      'Workspace dispatch slots are full for this worker cycle. Scout will retry automatically.',
      effective_limit, used_count, greatest(0, effective_limit - used_count), dispatch_time, a.next_eligible_at;
    return;
  end if;

  workspace_gap_seconds := 3 + floor(random() * 4)::integer;
  update public.workspace_dispatch_state
  set next_dispatch_at = dispatch_time + make_interval(secs => workspace_gap_seconds), updated_at = now()
  where workspace_id = target_workspace;

  next_time := dispatch_time + make_interval(secs => (90 + floor(random() * 121))::integer);
  insert into public.sender_send_reservations(
    workspace_id, gmail_account_id, status, effective_daily_limit, used_before, dispatch_at, expires_at, raw
  ) values (
    target_workspace, target_account, 'reserved', effective_limit, used_count, dispatch_time,
    dispatch_time + interval '10 minutes', coalesce(reservation_raw, '{}'::jsonb)
  ) returning id into new_reservation;

  update public.gmail_accounts
  set next_eligible_at = next_time,
      health_cap = health_limit,
      updated_at = now()
  where id = target_account and workspace_id = target_workspace;

  return query select true, new_reservation, 'Reserved.', effective_limit, used_count,
    greatest(0, effective_limit - used_count - 1), dispatch_time, next_time;
end;
$$;

revoke all on function public.reserve_sender_send(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_sender_send(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

select
  'READY'::text as scout_database_status,
  250::integer as hard_daily_ceiling,
  '90-210 seconds'::text as same_gmail_delay,
  '3-6 seconds'::text as different_gmail_delay,
  '3 occurrences in 14 days'::text as hard_restriction_rule,
  to_regprocedure('public.reserve_sender_send(uuid,uuid,jsonb)') is not null as sender_safety_ready;
-- <<< END SCOUT V10.38 FINAL SENDER RECOVERY + THREE-STRIKE PATCH

-- =============================================================================
-- SCOUT v10.38.3 CENTRAL MESSAGE WORKER + DASHBOARD REPAIR
-- Installs the durable Supabase Cron worker used by the GitHub verification app.
-- The app configures the URL and secret automatically from its Vercel environment.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.configure_scout_message_worker(
  target_app_url text,
  target_worker_secret text,
  target_seconds integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault, cron, net
as $$
declare
  clean_url text;
  safe_seconds integer;
  url_secret_id uuid;
  worker_secret_id uuid;
  scheduled_job_id bigint;
  worker_command text;
begin
  clean_url := regexp_replace(trim(coalesce(target_app_url, '')), '/+$', '');
  safe_seconds := greatest(10, least(60, coalesce(target_seconds, 15)));

  if clean_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Scout worker app URL must be a valid HTTPS URL.';
  end if;
  if length(trim(coalesce(target_worker_secret, ''))) < 24 then
    raise exception 'Scout worker secret must contain at least 24 characters.';
  end if;

  select id into url_secret_id
  from vault.secrets
  where name = 'scout_message_worker_app_url'
  order by created_at desc
  limit 1;

  if url_secret_id is null then
    perform vault.create_secret(
      clean_url,
      'scout_message_worker_app_url',
      'Scout production app URL used by the central message worker.'
    );
  else
    perform vault.update_secret(
      url_secret_id,
      clean_url,
      'scout_message_worker_app_url',
      'Scout production app URL used by the central message worker.'
    );
  end if;

  select id into worker_secret_id
  from vault.secrets
  where name = 'scout_message_worker_secret'
  order by created_at desc
  limit 1;

  if worker_secret_id is null then
    perform vault.create_secret(
      trim(target_worker_secret),
      'scout_message_worker_secret',
      'Private authorization secret for the Scout central message worker.'
    );
  else
    perform vault.update_secret(
      worker_secret_id,
      trim(target_worker_secret),
      'scout_message_worker_secret',
      'Private authorization secret for the Scout central message worker.'
    );
  end if;

  worker_command := $worker$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_app_url' order by created_at desc limit 1)
        || '/api/message/run-schedules',
      body := jsonb_build_object(
        'limit', 1,
        'token', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_secret' order by created_at desc limit 1)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-schedule-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_secret' order by created_at desc limit 1)
      ),
      timeout_milliseconds := 10000
    ) as request_id;
  $worker$;

  for scheduled_job_id in
    select jobid from cron.job where jobname = 'scout-message-worker-every-15-seconds'
  loop
    perform cron.unschedule(scheduled_job_id);
  end loop;

  select cron.schedule(
    'scout-message-worker-every-15-seconds',
    safe_seconds::text || ' seconds',
    worker_command
  ) into scheduled_job_id;

  return jsonb_build_object(
    'ready', true,
    'job_id', scheduled_job_id,
    'job_name', 'scout-message-worker-every-15-seconds',
    'schedule', safe_seconds::text || ' seconds',
    'app_url', clean_url
  );
end;
$$;

revoke all on function public.configure_scout_message_worker(text, text, integer) from public, anon, authenticated;
grant execute on function public.configure_scout_message_worker(text, text, integer) to service_role;

create or replace function public.scout_message_worker_status()
returns jsonb
language sql
security definer
set search_path = public, vault, cron
as $$
  with worker_job as (
    select jobid, schedule, active
    from cron.job
    where jobname = 'scout-message-worker-every-15-seconds'
    order by jobid desc
    limit 1
  ), latest_run as (
    select d.status, d.return_message, d.start_time, d.end_time
    from cron.job_run_details d
    join worker_job j on j.jobid = d.jobid
    order by d.start_time desc
    limit 1
  ), latest_success as (
    select d.end_time
    from cron.job_run_details d
    join worker_job j on j.jobid = d.jobid
    where d.status = 'succeeded'
    order by d.start_time desc
    limit 1
  )
  select jsonb_build_object(
    'ready', coalesce((select active from worker_job), false)
      and exists(select 1 from vault.secrets where name = 'scout_message_worker_app_url')
      and exists(select 1 from vault.secrets where name = 'scout_message_worker_secret'),
    'job_name', 'scout-message-worker-every-15-seconds',
    'schedule', coalesce((select schedule from worker_job), ''),
    'active', coalesce((select active from worker_job), false),
    'app_url_configured', exists(select 1 from vault.secrets where name = 'scout_message_worker_app_url'),
    'secret_configured', exists(select 1 from vault.secrets where name = 'scout_message_worker_secret'),
    'last_run_status', coalesce((select status from latest_run), ''),
    'last_run_at', (select coalesce(end_time, start_time) from latest_run),
    'last_success_at', (select end_time from latest_success),
    'last_message', coalesce((select return_message from latest_run), '')
  );
$$;

revoke all on function public.scout_message_worker_status() from public, anon, authenticated;
grant execute on function public.scout_message_worker_status() to service_role;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.configure_scout_message_worker(text,text,integer)') is not null as worker_config_function_ready,
  to_regprocedure('public.scout_message_worker_status()') is not null as worker_status_function_ready;
