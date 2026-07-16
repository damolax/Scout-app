-- Scout v10.35 — Safe Sending & Google Verification
-- Additive only. No workspace, signup, role, upload, country, or lead-ownership redesign.

create extension if not exists pgcrypto;

alter table if exists public.workspaces
  add column if not exists timezone text not null default 'UTC';

alter table if exists public.gmail_accounts
  add column if not exists sending_mode text not null default 'warmup',
  add column if not exists health_status text not null default 'new',
  add column if not exists warmup_started_at timestamptz,
  add column if not exists warmup_daily_cap integer,
  add column if not exists provider_limit_count integer not null default 0,
  add column if not exists last_provider_limit_at timestamptz,
  add column if not exists last_successful_send_at timestamptz;

alter table if exists public.gmail_accounts alter column daily_limit set default 250;
alter table if exists public.gmail_accounts alter column default_run_limit set default 50;

-- Existing senders keep their existing numeric limits. They begin in Normal mode
-- so this migration does not unexpectedly slow an established production account.
update public.gmail_accounts
set sending_mode = 'normal',
    health_status = case
      when status in ('limit_hit', 'sender_limited') then 'sender_limited'
      when status in ('paused', 'blocked') then 'paused'
      else 'needs_review'
    end,
    updated_at = now()
where coalesce(raw->>'v10_35_initialized', '') <> 'true';

update public.gmail_accounts
set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('v10_35_initialized', true),
    updated_at = now()
where coalesce(raw->>'v10_35_initialized', '') <> 'true';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gmail_accounts_sending_mode_check'
  ) then
    alter table public.gmail_accounts add constraint gmail_accounts_sending_mode_check
      check (sending_mode in ('warmup', 'normal', 'fast')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'gmail_accounts_health_status_check'
  ) then
    alter table public.gmail_accounts add constraint gmail_accounts_health_status_check
      check (health_status in ('new','warming','healthy','recovering','at_risk','sender_limited','paused','needs_review')) not valid;
  end if;
end $$;

alter table if exists public.reply_history
  add column if not exists hidden_at timestamptz,
  add column if not exists manual_classification text,
  add column if not exists classification_corrected_at timestamptz;

create table if not exists public.sender_send_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  schedule_id uuid,
  batch_id text,
  status text not null default 'reserved' check (status in ('reserved','sent','released')),
  reserved_at timestamptz not null default now(),
  finalized_at timestamptz,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists sender_send_reservations_account_active_idx
  on public.sender_send_reservations(gmail_account_id, status, reserved_at desc);
create index if not exists sender_send_reservations_schedule_idx
  on public.sender_send_reservations(schedule_id, gmail_account_id, status);
create unique index if not exists sender_send_reservations_one_active_idx
  on public.sender_send_reservations(gmail_account_id)
  where status = 'reserved';
create index if not exists sent_messages_sender_time_idx
  on public.sent_messages(workspace_id, gmail_account_id, sent_at desc)
  where status = 'sent';
create index if not exists sent_messages_from_time_idx
  on public.sent_messages(workspace_id, lower(from_email), sent_at desc)
  where status = 'sent';
create index if not exists reply_history_visible_time_idx
  on public.reply_history(workspace_id, hidden_at, received_at desc);

-- Atomically reserve one send slot. The account advisory lock prevents two
-- campaigns from consuming the same remaining quota at the same moment.
create or replace function public.reserve_scout_sender_slot(
  p_workspace_id uuid,
  p_gmail_account_id uuid,
  p_schedule_id uuid,
  p_batch_id text,
  p_timezone text default 'UTC',
  p_daily_limit integer default 250,
  p_effective_limit integer default 250,
  p_run_limit integer default 50
)
returns table (
  allowed boolean,
  reservation_id uuid,
  reason text,
  sent_today integer,
  sent_rolling_24h integer,
  sent_this_run integer,
  remaining_today integer,
  remaining_rolling_24h integer,
  remaining_this_run integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.gmail_accounts%rowtype;
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_day_start timestamptz;
  v_today integer := 0;
  v_rolling integer := 0;
  v_run integer := 0;
  v_reserved_today integer := 0;
  v_reserved_rolling integer := 0;
  v_reserved_run integer := 0;
  v_orphan_sent_today integer := 0;
  v_orphan_sent_rolling integer := 0;
  v_orphan_sent_run integer := 0;
  v_daily_cap integer := greatest(1, least(coalesce(p_daily_limit, 250), coalesce(p_effective_limit, 250)));
  v_run_cap integer := greatest(1, coalesce(p_run_limit, 50));
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_gmail_account_id::text, 0));

  select * into v_account
  from public.gmail_accounts
  where id = p_gmail_account_id and workspace_id = p_workspace_id
  for update;

  if not found then
    return query select false, null::uuid, 'Sender account was not found.', 0, 0, 0, 0, 0, 0;
    return;
  end if;

  if v_account.status in ('limit_hit','sender_limited','blocked')
     or v_account.is_paused is true
     or (v_account.paused_until is not null and v_account.paused_until > now()) then
    return query select false, null::uuid, 'Sender is paused or provider-limited.', 0, 0, 0, 0, 0, 0;
    return;
  end if;

  begin
    v_day_start := (date_trunc('day', now() at time zone v_timezone) at time zone v_timezone);
  exception when others then
    v_timezone := 'UTC';
    v_day_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  end;

  select count(*)::integer into v_today
  from public.sent_messages
  where workspace_id = p_workspace_id
    and gmail_account_id = p_gmail_account_id
    and status = 'sent'
    and sent_at >= v_day_start;

  select count(*)::integer into v_rolling
  from public.sent_messages
  where workspace_id = p_workspace_id
    and gmail_account_id = p_gmail_account_id
    and status = 'sent'
    and sent_at >= now() - interval '24 hours';

  select count(*)::integer into v_run
  from public.sent_messages
  where workspace_id = p_workspace_id
    and gmail_account_id = p_gmail_account_id
    and status = 'sent'
    and coalesce(raw->>'schedule_id', '') = coalesce(p_schedule_id::text, '');

  -- Reservations older than 30 minutes are abandoned and do not consume quota.
  update public.sender_send_reservations
  set status = 'released', finalized_at = now(), raw = raw || jsonb_build_object('auto_released', true)
  where gmail_account_id = p_gmail_account_id
    and status = 'reserved'
    and reserved_at < now() - interval '30 minutes';

  -- Only one active send may use a Gmail account at a time. This makes the
  -- saved lane interval effective even when two Scout jobs overlap.
  if exists (
    select 1 from public.sender_send_reservations
    where gmail_account_id = p_gmail_account_id and status = 'reserved'
  ) then
    return query select false, null::uuid, 'Sender is busy in another Scout job.', v_today, v_rolling, v_run,
      greatest(0, v_daily_cap - v_today), greatest(0, v_daily_cap - v_rolling), greatest(0, v_run_cap - v_run);
    return;
  end if;

  select count(*)::integer into v_reserved_today
  from public.sender_send_reservations
  where gmail_account_id = p_gmail_account_id
    and status = 'reserved'
    and reserved_at >= v_day_start;

  select count(*)::integer into v_reserved_rolling
  from public.sender_send_reservations
  where gmail_account_id = p_gmail_account_id
    and status = 'reserved'
    and reserved_at >= now() - interval '24 hours';

  select count(*)::integer into v_reserved_run
  from public.sender_send_reservations
  where gmail_account_id = p_gmail_account_id
    and schedule_id is not distinct from p_schedule_id
    and status = 'reserved';

  -- A Gmail send can succeed even if saving sent_messages later fails. Keep the
  -- finalized reservation as a durable quota record, but do not double-count it
  -- when a matching sent_messages row exists.
  select count(*)::integer into v_orphan_sent_today
  from public.sender_send_reservations r
  where r.workspace_id = p_workspace_id
    and r.gmail_account_id = p_gmail_account_id
    and r.status = 'sent'
    and coalesce(r.finalized_at, r.reserved_at) >= v_day_start
    and not exists (
      select 1 from public.sent_messages sm
      where sm.workspace_id = p_workspace_id
        and sm.gmail_account_id = p_gmail_account_id
        and sm.status = 'sent'
        and sm.raw->>'reservation_id' = r.id::text
    );

  select count(*)::integer into v_orphan_sent_rolling
  from public.sender_send_reservations r
  where r.workspace_id = p_workspace_id
    and r.gmail_account_id = p_gmail_account_id
    and r.status = 'sent'
    and coalesce(r.finalized_at, r.reserved_at) >= now() - interval '24 hours'
    and not exists (
      select 1 from public.sent_messages sm
      where sm.workspace_id = p_workspace_id
        and sm.gmail_account_id = p_gmail_account_id
        and sm.status = 'sent'
        and sm.raw->>'reservation_id' = r.id::text
    );

  select count(*)::integer into v_orphan_sent_run
  from public.sender_send_reservations r
  where r.workspace_id = p_workspace_id
    and r.gmail_account_id = p_gmail_account_id
    and r.schedule_id is not distinct from p_schedule_id
    and r.status = 'sent'
    and not exists (
      select 1 from public.sent_messages sm
      where sm.workspace_id = p_workspace_id
        and sm.gmail_account_id = p_gmail_account_id
        and sm.status = 'sent'
        and sm.raw->>'reservation_id' = r.id::text
    );

  v_today := v_today + v_reserved_today + v_orphan_sent_today;
  v_rolling := v_rolling + v_reserved_rolling + v_orphan_sent_rolling;
  v_run := v_run + v_reserved_run + v_orphan_sent_run;

  if v_today >= v_daily_cap then
    return query select false, null::uuid, 'Daily safe limit reached.', v_today, v_rolling, v_run,
      greatest(0, v_daily_cap - v_today), greatest(0, v_daily_cap - v_rolling), greatest(0, v_run_cap - v_run);
    return;
  end if;
  if v_rolling >= v_daily_cap then
    return query select false, null::uuid, 'Rolling 24-hour safe limit reached.', v_today, v_rolling, v_run,
      greatest(0, v_daily_cap - v_today), greatest(0, v_daily_cap - v_rolling), greatest(0, v_run_cap - v_run);
    return;
  end if;
  if v_run >= v_run_cap then
    return query select false, null::uuid, 'Maximum for this run reached.', v_today, v_rolling, v_run,
      greatest(0, v_daily_cap - v_today), greatest(0, v_daily_cap - v_rolling), greatest(0, v_run_cap - v_run);
    return;
  end if;

  insert into public.sender_send_reservations(workspace_id, gmail_account_id, schedule_id, batch_id, raw)
  values (p_workspace_id, p_gmail_account_id, p_schedule_id, p_batch_id,
    jsonb_build_object('timezone', v_timezone, 'daily_cap', v_daily_cap, 'run_cap', v_run_cap))
  returning id into v_id;

  return query select true, v_id, 'Reserved.', v_today, v_rolling, v_run,
    greatest(0, v_daily_cap - v_today - 1), greatest(0, v_daily_cap - v_rolling - 1), greatest(0, v_run_cap - v_run - 1);
end;
$$;

create or replace function public.finalize_scout_sender_slot(
  p_reservation_id uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sender_send_reservations
  set status = case when p_success then 'sent' else 'released' end,
      finalized_at = now(),
      raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('error', p_error)
  where id = p_reservation_id and status = 'reserved';
  return found;
end;
$$;

revoke all on function public.reserve_scout_sender_slot(uuid,uuid,uuid,text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.finalize_scout_sender_slot(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.reserve_scout_sender_slot(uuid,uuid,uuid,text,text,integer,integer,integer) to service_role;
grant execute on function public.finalize_scout_sender_slot(uuid,boolean,text) to service_role;

-- Keep ordinary users away from internal reservations. The worker uses the
-- service-role key and the RPCs above.
alter table public.sender_send_reservations enable row level security;

notify pgrst, 'reload schema';

-- Server-side Team page pagination/search. Only the main Scout admin can call
-- these helpers; connected Gmail addresses are never returned.
create or replace function public.admin_team_dashboard_summary()
returns table(
  registered_users bigint,
  connected_accounts bigint,
  lifetime_sent bigint,
  real_replies bigint,
  total_leads bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
  ) then
    raise exception 'Only the main Scout admin can read Team Dashboard';
  end if;

  return query
  select
    (select count(*) from auth.users)::bigint,
    (select count(*) from public.gmail_accounts ga where coalesce(ga.status, '') in ('connected','active','ready'))::bigint,
    (select count(*) from public.sent_messages sm where coalesce(sm.status, '') in ('sent','delivered'))::bigint,
    (select count(*) from public.reply_history rh where coalesce(rh.is_real_reply, false) = true)::bigint,
    (select count(*) from public.businesses b)::bigint;
end;
$$;

create or replace function public.admin_team_dashboard_page(
  p_search text default '',
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 20
)
returns table(
  user_id uuid,
  full_name text,
  user_email text,
  workspace_id uuid,
  workspace_name text,
  lifetime_sent bigint,
  connected_senders bigint,
  total_leads bigint,
  ready_leads bigint,
  real_replies bigint,
  auto_replies bigint,
  no_inbox_count bigint,
  created_at timestamptz,
  matching_count bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_sort text := case when lower(coalesce(p_sort, '')) = 'oldest' then 'oldest' else 'newest' end;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(100, coalesce(p_page_size, 20)));
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
  ) then
    raise exception 'Only the main Scout admin can read Team Dashboard';
  end if;

  return query
  with user_workspaces as (
    select
      u.id as user_id,
      coalesce(nullif(trim(p.full_name), ''), split_part(coalesce(u.email, p.email, ''), '@', 1))::text as full_name,
      coalesce(u.email, p.email)::text as user_email,
      selected.workspace_id,
      w.name::text as workspace_name,
      u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join lateral (
      select wm.workspace_id
      from public.workspace_members wm
      where wm.user_id = u.id and wm.approved = true
      order by case when wm.role = 'admin' then 0 else 1 end, wm.created_at asc
      limit 1
    ) selected on true
    left join public.workspaces w on w.id = selected.workspace_id
  ),
  sent_stats as (
    select sm.workspace_id, count(*)::bigint as lifetime_sent
    from public.sent_messages sm
    where coalesce(sm.status, '') in ('sent','delivered')
    group by sm.workspace_id
  ),
  sender_stats as (
    select ga.workspace_id, count(*)::bigint as connected_senders
    from public.gmail_accounts ga
    where coalesce(ga.status, '') in ('connected','active','ready')
    group by ga.workspace_id
  ),
  lead_stats as (
    select b.workspace_id,
      count(*)::bigint as total_leads,
      count(*) filter (where coalesce(b.status, '') in ('ready','found'))::bigint as ready_leads
    from public.businesses b
    group by b.workspace_id
  ),
  reply_stats as (
    select rh.workspace_id,
      count(*) filter (where coalesce(rh.is_real_reply, false) = true)::bigint as real_replies,
      count(*) filter (where coalesce(rh.is_auto_reply, false) = true)::bigint as auto_replies
    from public.reply_history rh
    group by rh.workspace_id
  ),
  no_inbox_stats as (
    select ni.workspace_id, count(*)::bigint as no_inbox_count
    from public.no_inbox_records ni
    group by ni.workspace_id
  ),
  base as (
    select
      uw.user_id,
      uw.full_name,
      uw.user_email,
      uw.workspace_id,
      uw.workspace_name,
      coalesce(ss.lifetime_sent, 0)::bigint as lifetime_sent,
      coalesce(gs.connected_senders, 0)::bigint as connected_senders,
      coalesce(ls.total_leads, 0)::bigint as total_leads,
      coalesce(ls.ready_leads, 0)::bigint as ready_leads,
      coalesce(rs.real_replies, 0)::bigint as real_replies,
      coalesce(rs.auto_replies, 0)::bigint as auto_replies,
      coalesce(ns.no_inbox_count, 0)::bigint as no_inbox_count,
      uw.created_at
    from user_workspaces uw
    left join sent_stats ss on ss.workspace_id = uw.workspace_id
    left join sender_stats gs on gs.workspace_id = uw.workspace_id
    left join lead_stats ls on ls.workspace_id = uw.workspace_id
    left join reply_stats rs on rs.workspace_id = uw.workspace_id
    left join no_inbox_stats ns on ns.workspace_id = uw.workspace_id
  ),
  filtered as (
    select b.*
    from base b
    where v_search = ''
      or lower(coalesce(b.full_name, '')) like '%' || v_search || '%'
      or lower(coalesce(b.user_email, '')) like '%' || v_search || '%'
  )
  select
    f.user_id,
    f.full_name,
    f.user_email,
    f.workspace_id,
    f.workspace_name,
    f.lifetime_sent,
    f.connected_senders,
    f.total_leads,
    f.ready_leads,
    f.real_replies,
    f.auto_replies,
    f.no_inbox_count,
    f.created_at,
    count(*) over()::bigint as matching_count
  from filtered f
  order by
    case when v_sort = 'oldest' then f.created_at end asc nulls last,
    case when v_sort = 'newest' then f.created_at end desc nulls last,
    lower(coalesce(f.user_email, '')) asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

revoke all on function public.admin_team_dashboard_summary() from public, anon;
revoke all on function public.admin_team_dashboard_page(text,text,integer,integer) from public, anon;
grant execute on function public.admin_team_dashboard_summary() to authenticated;
grant execute on function public.admin_team_dashboard_page(text,text,integer,integer) to authenticated;

create table if not exists public.template_health_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete cascade,
  sent_count integer not null default 0,
  real_reply_count integer not null default 0,
  alerted_at timestamptz not null default now(),
  dismissed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  unique(workspace_id, template_id)
);
create index if not exists template_health_alerts_open_idx on public.template_health_alerts(workspace_id, dismissed_at, alerted_at desc);
alter table public.template_health_alerts enable row level security;
notify pgrst, 'reload schema';
