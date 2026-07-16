-- Scout v10.35.1 — Scale Guard R3
-- Additive and idempotent. Run after RUN_THIS_SQL_FIRST_V10_35.sql.
-- R3 safely skips historical sent-message references to Gmail accounts that were already deleted.
-- No workspace, signup, role, country, upload, template, or lead-ownership redesign.

create extension if not exists pgcrypto;

-- Clear preflight: the original v10.35 additive migration must already exist.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'timezone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gmail_accounts' and column_name = 'sending_mode'
  ) or to_regprocedure('public.reserve_scout_sender_slot(uuid,uuid,uuid,text,text,integer,integer,integer)') is null then
    raise exception 'Scout v10.35 prerequisite is missing. Run RUN_THIS_SQL_FIRST_V10_35.sql successfully before this Scale Guard SQL.';
  end if;
end $$;

-- Live-schema compatibility repair. Earlier Scout releases created
-- seed_inbox_tests with gmail_account_id/from_email/to_email/provider_message_id,
-- while the deliverability UI uses sender_gmail_account_id/sender_email/
-- seed_email/gmail_message_id. Keep both layouts synchronized so this migration
-- is safe on existing production projects and on newer installations.
create table if not exists public.seed_inbox_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  sender_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  seed_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  from_email text,
  to_email text,
  sender_email text,
  seed_email text,
  subject text,
  provider_message_id text,
  gmail_message_id text,
  gmail_thread_id text,
  placement text,
  status text not null default 'pending',
  checked_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seed_inbox_tests
  add column if not exists gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  add column if not exists sender_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  add column if not exists seed_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  add column if not exists from_email text,
  add column if not exists to_email text,
  add column if not exists sender_email text,
  add column if not exists seed_email text,
  add column if not exists provider_message_id text,
  add column if not exists gmail_message_id text,
  add column if not exists status text not null default 'pending',
  add column if not exists updated_at timestamptz not null default now();

alter table public.gmail_accounts
  add column if not exists profile_picture_url text;

-- Copy the legacy sender ID into the new FK-backed column only when the
-- Gmail account still exists. Historical rows may legitimately reference an
-- account that was disconnected/deleted; their email/message metadata remains
-- intact and is not deleted or rewritten.
update public.seed_inbox_tests st
set sender_gmail_account_id = coalesce(
      st.sender_gmail_account_id,
      case
        when st.gmail_account_id is not null
         and exists (
           select 1 from public.gmail_accounts ga
           where ga.id = st.gmail_account_id
             and (st.workspace_id is null or ga.workspace_id = st.workspace_id)
         )
        then st.gmail_account_id
        else null
      end
    ),
    gmail_account_id = coalesce(st.gmail_account_id, st.sender_gmail_account_id),
    sender_email = coalesce(st.sender_email, st.from_email),
    from_email = coalesce(st.from_email, st.sender_email),
    seed_email = coalesce(st.seed_email, st.to_email),
    to_email = coalesce(st.to_email, st.seed_email),
    gmail_message_id = coalesce(st.gmail_message_id, st.provider_message_id),
    provider_message_id = coalesce(st.provider_message_id, st.gmail_message_id),
    updated_at = coalesce(st.updated_at, st.created_at, now())
where st.sender_gmail_account_id is distinct from coalesce(
        st.sender_gmail_account_id,
        case
          when st.gmail_account_id is not null
           and exists (
             select 1 from public.gmail_accounts ga
             where ga.id = st.gmail_account_id
               and (st.workspace_id is null or ga.workspace_id = st.workspace_id)
           )
          then st.gmail_account_id
          else null
        end
      )
   or st.gmail_account_id is distinct from coalesce(st.gmail_account_id, st.sender_gmail_account_id)
   or st.sender_email is distinct from coalesce(st.sender_email, st.from_email)
   or st.from_email is distinct from coalesce(st.from_email, st.sender_email)
   or st.seed_email is distinct from coalesce(st.seed_email, st.to_email)
   or st.to_email is distinct from coalesce(st.to_email, st.seed_email)
   or st.gmail_message_id is distinct from coalesce(st.gmail_message_id, st.provider_message_id)
   or st.provider_message_id is distinct from coalesce(st.provider_message_id, st.gmail_message_id);

create or replace function public.sync_seed_inbox_test_compatibility()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Do not copy a stale/deleted legacy Gmail account ID into the FK-backed
  -- sender_gmail_account_id column. Preserve the legacy value and message
  -- metadata, but leave the new relation null when the account no longer exists.
  if new.sender_gmail_account_id is null
     and new.gmail_account_id is not null
     and exists (
       select 1 from public.gmail_accounts ga
       where ga.id = new.gmail_account_id
         and (new.workspace_id is null or ga.workspace_id = new.workspace_id)
     ) then
    new.sender_gmail_account_id := new.gmail_account_id;
  end if;

  if new.gmail_account_id is null then
    new.gmail_account_id := new.sender_gmail_account_id;
  end if;

  new.sender_email := coalesce(new.sender_email, new.from_email);
  new.from_email := coalesce(new.from_email, new.sender_email);
  new.seed_email := coalesce(new.seed_email, new.to_email);
  new.to_email := coalesce(new.to_email, new.seed_email);
  new.gmail_message_id := coalesce(new.gmail_message_id, new.provider_message_id);
  new.provider_message_id := coalesce(new.provider_message_id, new.gmail_message_id);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists seed_inbox_tests_compatibility_sync on public.seed_inbox_tests;
create trigger seed_inbox_tests_compatibility_sync
before insert or update on public.seed_inbox_tests
for each row execute function public.sync_seed_inbox_test_compatibility();

create index if not exists message_schedules_due_scale_guard_idx
  on public.message_schedules(status, scheduled_for, updated_at)
  where status = 'scheduled';
create index if not exists message_schedules_workspace_due_scale_guard_idx
  on public.message_schedules(workspace_id, status, scheduled_for)
  where status in ('scheduled','running');
create index if not exists sent_messages_workspace_sender_status_time_idx
  on public.sent_messages(workspace_id, gmail_account_id, status, sent_at desc);
create index if not exists gmail_accounts_workspace_status_created_idx
  on public.gmail_accounts(workspace_id, status, created_at desc);
create index if not exists gmail_accounts_workspace_health_created_idx
  on public.gmail_accounts(workspace_id, health_status, created_at desc);
create index if not exists email_research_jobs_workspace_status_updated_idx
  on public.email_research_jobs(workspace_id, status, updated_at desc);
create index if not exists app_notifications_workspace_created_idx
  on public.app_notifications(workspace_id, created_at desc);
create index if not exists reply_history_workspace_sender_received_idx
  on public.reply_history(workspace_id, gmail_account_id, received_at desc);
create index if not exists no_inbox_workspace_sender_created_idx
  on public.no_inbox_records(workspace_id, gmail_account_id, created_at desc);
create index if not exists seed_inbox_workspace_sender_created_idx
  on public.seed_inbox_tests(workspace_id, sender_gmail_account_id, created_at desc);

-- One lease represents one campaign that is actively doing work. This stops a
-- burst of browser/server requests from starting hundreds of heavy jobs at once.
create table if not exists public.scout_campaign_leases (
  slot integer primary key check (slot > 0),
  lease_token uuid not null default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  schedule_id uuid not null references public.message_schedules(id) on delete cascade,
  leased_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists scout_campaign_leases_schedule_idx
  on public.scout_campaign_leases(schedule_id);
create index if not exists scout_campaign_leases_workspace_expiry_idx
  on public.scout_campaign_leases(workspace_id, leased_until);

-- One lease represents one Gmail sender lane. Limits are platform-wide and
-- workspace-aware, so multiple Vercel instances cannot each create 12 lanes.
create table if not exists public.scout_sender_lane_leases (
  slot integer primary key check (slot > 0),
  lease_token uuid not null default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  schedule_id uuid references public.message_schedules(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  leased_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists scout_sender_lane_leases_account_idx
  on public.scout_sender_lane_leases(gmail_account_id);
create index if not exists scout_sender_lane_leases_workspace_expiry_idx
  on public.scout_sender_lane_leases(workspace_id, leased_until);

-- Direct one-off sends (for example Email Scout) also use the shared sender
-- lane guard, but do not have a message_schedules row.
alter table public.scout_sender_lane_leases
  alter column schedule_id drop not null;

create or replace function public.acquire_scout_campaign_lease(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_platform_limit integer default 12,
  p_workspace_limit integer default 1,
  p_lease_seconds integer default 900
)
returns table(allowed boolean, lease_token uuid, slot integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot integer;
  v_token uuid := gen_random_uuid();
  v_platform_limit integer := greatest(1, least(coalesce(p_platform_limit, 12), 200));
  v_workspace_limit integer := greatest(1, least(coalesce(p_workspace_limit, 1), 25));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 7200));
begin
  perform pg_advisory_xact_lock(hashtextextended('scout_campaign_leases', 0));

  delete from public.scout_campaign_leases where leased_until <= now();

  if exists (select 1 from public.scout_campaign_leases l where l.schedule_id = p_schedule_id) then
    return query select false, null::uuid, null::integer, 'Campaign is already active in another worker.'::text;
    return;
  end if;

  if (select count(*) from public.scout_campaign_leases l where l.workspace_id = p_workspace_id and l.leased_until > now()) >= v_workspace_limit then
    return query select false, null::uuid, null::integer, 'Workspace campaign capacity is busy. Job remains queued.'::text;
    return;
  end if;

  select candidate into v_slot
  from generate_series(1, v_platform_limit) candidate
  where not exists (
    select 1 from public.scout_campaign_leases l
    where l.slot = candidate and l.leased_until > now()
  )
  order by candidate
  limit 1;

  if v_slot is null then
    return query select false, null::uuid, null::integer, 'Platform campaign capacity is busy. Job remains queued.'::text;
    return;
  end if;

  insert into public.scout_campaign_leases(slot, lease_token, workspace_id, schedule_id, leased_until)
  values (v_slot, v_token, p_workspace_id, p_schedule_id, now() + make_interval(secs => v_lease_seconds));

  return query select true, v_token, v_slot, 'Campaign capacity reserved.'::text;
end;
$$;

create or replace function public.renew_scout_campaign_lease(
  p_lease_token uuid,
  p_lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scout_campaign_leases
  set leased_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 7200))),
      updated_at = now()
  where lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.release_scout_campaign_lease(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.scout_campaign_leases where lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.acquire_scout_sender_lane(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_gmail_account_id uuid,
  p_platform_limit integer default 12,
  p_workspace_limit integer default 2,
  p_lease_seconds integer default 600
)
returns table(allowed boolean, lease_token uuid, slot integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot integer;
  v_token uuid := gen_random_uuid();
  v_platform_limit integer := greatest(1, least(coalesce(p_platform_limit, 12), 500));
  v_workspace_limit integer := greatest(1, least(coalesce(p_workspace_limit, 2), 50));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 7200));
begin
  perform pg_advisory_xact_lock(hashtextextended('scout_sender_lane_leases', 0));

  delete from public.scout_sender_lane_leases where leased_until <= now();

  if exists (select 1 from public.scout_sender_lane_leases l where l.gmail_account_id = p_gmail_account_id) then
    return query select false, null::uuid, null::integer, 'Sender is active in another Scout lane.'::text;
    return;
  end if;

  if (select count(*) from public.scout_sender_lane_leases l where l.workspace_id = p_workspace_id and l.leased_until > now()) >= v_workspace_limit then
    return query select false, null::uuid, null::integer, 'Workspace sender capacity is busy.'::text;
    return;
  end if;

  select candidate into v_slot
  from generate_series(1, v_platform_limit) candidate
  where not exists (
    select 1 from public.scout_sender_lane_leases l
    where l.slot = candidate and l.leased_until > now()
  )
  order by candidate
  limit 1;

  if v_slot is null then
    return query select false, null::uuid, null::integer, 'Platform sender capacity is busy.'::text;
    return;
  end if;

  insert into public.scout_sender_lane_leases(slot, lease_token, workspace_id, schedule_id, gmail_account_id, leased_until)
  values (v_slot, v_token, p_workspace_id, p_schedule_id, p_gmail_account_id, now() + make_interval(secs => v_lease_seconds));

  return query select true, v_token, v_slot, 'Sender lane reserved.'::text;
end;
$$;

create or replace function public.renew_scout_sender_lane(
  p_lease_token uuid,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scout_sender_lane_leases
  set leased_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 7200))),
      updated_at = now()
  where lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.release_scout_sender_lane(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.scout_sender_lane_leases where lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_scout_campaign_lease(uuid,uuid,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.renew_scout_campaign_lease(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_scout_campaign_lease(uuid) from public, anon, authenticated;
revoke all on function public.acquire_scout_sender_lane(uuid,uuid,uuid,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.renew_scout_sender_lane(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_scout_sender_lane(uuid) from public, anon, authenticated;
grant execute on function public.acquire_scout_campaign_lease(uuid,uuid,integer,integer,integer) to service_role;
grant execute on function public.renew_scout_campaign_lease(uuid,integer) to service_role;
grant execute on function public.release_scout_campaign_lease(uuid) to service_role;
grant execute on function public.acquire_scout_sender_lane(uuid,uuid,uuid,integer,integer,integer) to service_role;
grant execute on function public.renew_scout_sender_lane(uuid,integer) to service_role;
grant execute on function public.release_scout_sender_lane(uuid) to service_role;

alter table public.scout_campaign_leases enable row level security;
alter table public.scout_sender_lane_leases enable row level security;


-- Permanent lightweight lifetime totals. Full sent-message rows can later be
-- archived without losing sender totals, and Settings no longer recounts the
-- complete history every time it opens.
create table if not exists public.scout_sender_lifetime_stats (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  lifetime_sent bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, gmail_account_id)
);

-- Some historical sent_messages rows can retain the UUID of an account that
-- was later disconnected/deleted because older releases did not enforce a
-- foreign key on sent_messages.gmail_account_id. Keep those sent records, but
-- skip them when building the active-account lifetime summary.
do $$
declare
  v_orphan_rows bigint := 0;
begin
  select count(*) into v_orphan_rows
  from public.sent_messages sm
  where sm.gmail_account_id is not null
    and coalesce(sm.status, '') in ('sent','delivered')
    and not exists (
      select 1 from public.gmail_accounts ga
      where ga.id = sm.gmail_account_id
        and ga.workspace_id = sm.workspace_id
    );

  if v_orphan_rows > 0 then
    raise notice 'Scale Guard R3: skipped % historical sent-message rows whose Gmail account no longer exists or belongs to another workspace. The sent-message rows were preserved.', v_orphan_rows;
  end if;
end $$;

insert into public.scout_sender_lifetime_stats(workspace_id, gmail_account_id, lifetime_sent, updated_at)
select sm.workspace_id, sm.gmail_account_id, count(*)::bigint, now()
from public.sent_messages sm
join public.gmail_accounts ga
  on ga.id = sm.gmail_account_id
 and ga.workspace_id = sm.workspace_id
where sm.gmail_account_id is not null
  and coalesce(sm.status, '') in ('sent','delivered')
group by sm.workspace_id, sm.gmail_account_id
on conflict (workspace_id, gmail_account_id) do update
set lifetime_sent = excluded.lifetime_sent,
    updated_at = now();

create or replace function public.increment_scout_sender_lifetime_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gmail_account_id is not null
     and coalesce(new.status, '') in ('sent','delivered')
     and exists (
       select 1 from public.gmail_accounts ga
       where ga.id = new.gmail_account_id
         and ga.workspace_id = new.workspace_id
     ) then
    insert into public.scout_sender_lifetime_stats(workspace_id, gmail_account_id, lifetime_sent, updated_at)
    values (new.workspace_id, new.gmail_account_id, 1, now())
    on conflict (workspace_id, gmail_account_id) do update
    set lifetime_sent = public.scout_sender_lifetime_stats.lifetime_sent + 1,
        updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists sent_messages_scout_lifetime_stats_insert on public.sent_messages;
create trigger sent_messages_scout_lifetime_stats_insert
after insert on public.sent_messages
for each row execute function public.increment_scout_sender_lifetime_stats();

alter table public.scout_sender_lifetime_stats enable row level security;

-- Safe, paginated Gmail account list. OAuth tokens never leave server-only
-- routes. Counts are grouped once instead of running one query per account.
create or replace function public.scout_sender_accounts_page(
  p_workspace_id uuid,
  p_search text default '',
  p_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  id uuid,
  workspace_id uuid,
  email text,
  display_name text,
  status text,
  has_credentials boolean,
  daily_limit integer,
  default_run_limit integer,
  sending_mode text,
  health_status text,
  warmup_started_at timestamptz,
  warmup_daily_cap integer,
  provider_limit_count integer,
  last_provider_limit_at timestamptz,
  last_successful_send_at timestamptz,
  account_type text,
  seed_inbox_enabled boolean,
  seed_test_address text,
  spam_risk_status text,
  last_seed_result text,
  last_seed_checked_at timestamptz,
  sent_today bigint,
  sent_rolling_24h bigint,
  lifetime_sent bigint,
  paused_until timestamptz,
  last_error text,
  is_paused boolean,
  paused_reason text,
  signature_enabled boolean,
  signature_text text,
  signature_html text,
  signature_logo_url text,
  profile_picture_url text,
  sync_signature_to_gmail boolean,
  gmail_signature_synced_at timestamptz,
  gmail_signature_sync_error text,
  created_at timestamptz,
  updated_at timestamptz,
  matching_count bigint,
  total_count bigint,
  connected_count bigint,
  paused_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_filter text := lower(trim(coalesce(p_filter, 'all')));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(100, coalesce(p_page_size, 25)));
  v_timezone text := 'UTC';
  v_day_start timestamptz;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  ) then
    raise exception 'You do not have access to this Scout workspace';
  end if;

  select coalesce(nullif(trim(w.timezone), ''), 'UTC') into v_timezone
  from public.workspaces w where w.id = p_workspace_id;
  begin
    v_day_start := date_trunc('day', now() at time zone v_timezone) at time zone v_timezone;
  exception when others then
    v_day_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  end;

  return query
  with recent_stats as (
    select
      sm.gmail_account_id as account_id,
      count(*) filter (where sm.sent_at >= v_day_start)::bigint as sent_today,
      count(*) filter (where sm.sent_at >= now() - interval '24 hours')::bigint as sent_rolling_24h
    from public.sent_messages sm
    where sm.workspace_id = p_workspace_id
      and sm.status = 'sent'
      and sm.sent_at >= least(v_day_start, now() - interval '24 hours')
    group by sm.gmail_account_id
  ),
  base as (
    select
      ga.*,
      coalesce(ls.lifetime_sent, 0)::bigint as lifetime_sent_actual,
      coalesce(rs.sent_today, 0)::bigint as sent_today_actual,
      coalesce(rs.sent_rolling_24h, 0)::bigint as sent_rolling_actual,
      ((ga.access_token is not null and ga.access_token <> '') or (ga.refresh_token is not null and ga.refresh_token <> '')) as has_credentials_actual,
      (ga.is_paused is true or ga.status in ('paused','limit_hit','sender_limited','blocked') or (ga.paused_until is not null and ga.paused_until > now())) as paused_actual
    from public.gmail_accounts ga
    left join public.scout_sender_lifetime_stats ls
      on ls.workspace_id = ga.workspace_id and ls.gmail_account_id = ga.id
    left join recent_stats rs on rs.account_id = ga.id
    where ga.workspace_id = p_workspace_id
  ),
  filtered as (
    select b.*
    from base b
    where (v_search = '' or lower(coalesce(b.email, '')) like '%' || v_search || '%' or lower(coalesce(b.display_name, '')) like '%' || v_search || '%')
      and (
        v_filter in ('', 'all')
        or (v_filter = 'connected' and b.status in ('connected','ready') and not b.paused_actual)
        or (v_filter = 'paused' and b.paused_actual)
        or (v_filter = 'healthy' and b.health_status = 'healthy')
        or (v_filter = 'warming' and b.health_status in ('new','warming','recovering'))
        or (v_filter = 'limited' and b.status in ('limit_hit','sender_limited'))
      )
  ),
  totals as (
    select
      count(*)::bigint as total_count,
      count(*) filter (where status in ('connected','ready') and not paused_actual)::bigint as connected_count,
      count(*) filter (where paused_actual)::bigint as paused_count
    from base
  )
  select
    f.id,
    f.workspace_id,
    f.email,
    f.display_name,
    f.status,
    f.has_credentials_actual,
    f.daily_limit,
    f.default_run_limit,
    f.sending_mode,
    f.health_status,
    f.warmup_started_at,
    f.warmup_daily_cap,
    f.provider_limit_count,
    f.last_provider_limit_at,
    f.last_successful_send_at,
    f.account_type,
    f.seed_inbox_enabled,
    f.seed_test_address,
    f.spam_risk_status,
    f.last_seed_result,
    f.last_seed_checked_at,
    f.sent_today_actual,
    f.sent_rolling_actual,
    f.lifetime_sent_actual,
    f.paused_until,
    f.last_error,
    f.is_paused,
    f.paused_reason,
    f.signature_enabled,
    f.signature_text,
    f.signature_html,
    f.signature_logo_url,
    f.profile_picture_url,
    f.sync_signature_to_gmail,
    f.gmail_signature_synced_at,
    f.gmail_signature_sync_error,
    f.created_at,
    f.updated_at,
    count(*) over()::bigint as matching_count,
    t.total_count,
    t.connected_count,
    t.paused_count
  from filtered f
  cross join totals t
  order by f.created_at desc, lower(f.email) asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

revoke all on function public.scout_sender_accounts_page(uuid,text,text,integer,integer) from public, anon;
grant execute on function public.scout_sender_accounts_page(uuid,text,text,integer,integer) to authenticated;

notify pgrst, 'reload schema';

create or replace function public.scout_deliverability_sender_summary(p_workspace_id uuid)
returns table(
  id uuid,
  email text,
  status text,
  daily_limit integer,
  default_run_limit integer,
  sending_mode text,
  health_status text,
  warmup_daily_cap integer,
  paused_until timestamptz,
  is_paused boolean,
  sent_7d bigint,
  sent_24h bigint,
  no_inbox_7d bigint,
  blocked_7d bigint,
  real_replies_7d bigint,
  auto_replies_7d bigint,
  limit_notices_7d bigint,
  seed_tests_7d bigint,
  spam_seeds_7d bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid() and wm.approved = true
  ) then
    raise exception 'You do not have access to this Scout workspace';
  end if;

  return query
  with sent as (
    select sm.gmail_account_id,
      count(*) filter (where sm.status = 'sent' and sm.sent_at >= now() - interval '7 days')::bigint as sent_7d,
      count(*) filter (where sm.status = 'sent' and sm.sent_at >= now() - interval '24 hours')::bigint as sent_24h
    from public.sent_messages sm
    where sm.workspace_id = p_workspace_id and sm.sent_at >= now() - interval '7 days'
    group by sm.gmail_account_id
  ), failures as (
    select ni.gmail_account_id,
      count(*)::bigint as no_inbox_7d,
      count(*) filter (where lower(coalesce(ni.reason, '') || ' ' || coalesce(ni.status, '') || ' ' || coalesce(ni.type, '')) like '%blocked%')::bigint as blocked_7d
    from public.no_inbox_records ni
    where ni.workspace_id = p_workspace_id and ni.created_at >= now() - interval '7 days'
    group by ni.gmail_account_id
  ), replies as (
    select rh.gmail_account_id,
      count(*) filter (where rh.is_real_reply is true or rh.reply_bucket = 'real_reply')::bigint as real_replies_7d,
      count(*) filter (where rh.is_auto_reply is true or rh.reply_bucket = 'auto_reply')::bigint as auto_replies_7d,
      count(*) filter (where rh.is_limit_notice is true or lower(coalesce(rh.reply_bucket, '') || ' ' || coalesce(rh.classification, '')) like '%limit%')::bigint as limit_notices_7d
    from public.reply_history rh
    where rh.workspace_id = p_workspace_id and rh.received_at >= now() - interval '7 days'
    group by rh.gmail_account_id
  ), seeds as (
    select coalesce(st.sender_gmail_account_id, st.gmail_account_id) as gmail_account_id,
      count(*)::bigint as seed_tests_7d,
      count(*) filter (where lower(coalesce(st.placement, '')) like '%spam%')::bigint as spam_seeds_7d
    from public.seed_inbox_tests st
    where st.workspace_id = p_workspace_id and st.created_at >= now() - interval '7 days'
    group by coalesce(st.sender_gmail_account_id, st.gmail_account_id)
  )
  select ga.id, ga.email, ga.status, ga.daily_limit, ga.default_run_limit,
    ga.sending_mode, ga.health_status, ga.warmup_daily_cap, ga.paused_until, ga.is_paused,
    coalesce(s.sent_7d, 0), coalesce(s.sent_24h, 0),
    coalesce(f.no_inbox_7d, 0), coalesce(f.blocked_7d, 0),
    coalesce(r.real_replies_7d, 0), coalesce(r.auto_replies_7d, 0), coalesce(r.limit_notices_7d, 0),
    coalesce(se.seed_tests_7d, 0), coalesce(se.spam_seeds_7d, 0)
  from public.gmail_accounts ga
  left join sent s on s.gmail_account_id = ga.id
  left join failures f on f.gmail_account_id = ga.id
  left join replies r on r.gmail_account_id = ga.id
  left join seeds se on se.gmail_account_id = ga.id
  where ga.workspace_id = p_workspace_id
  order by ga.created_at asc;
end;
$$;

revoke all on function public.scout_deliverability_sender_summary(uuid) from public, anon;
grant execute on function public.scout_deliverability_sender_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
