-- Scout v10.33 access recovery
-- Built against the live schema audit generated 2026-07-14.
-- Purpose:
--   * make oyekunleolalekan3168@gmail.com the only global admin;
--   * remove manual approval as an access gate;
--   * repair missing profiles/workspaces/memberships for every Auth user;
--   * downgrade regular workspace memberships from admin to member;
--   * restore private per-workspace RLS;
--   * make Team Dashboard count Auth users and show only connected-account totals.
-- This migration does not delete businesses, messages, templates, replies, Gmail accounts, or sending history.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.profiles
  add column if not exists full_name text;

-- The only global administrator is the exact email below.
create or replace function public.is_main_scout_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
  );
$$;

revoke all on function public.is_main_scout_admin() from public;
grant execute on function public.is_main_scout_admin() to authenticated, service_role;

-- A user belongs only to workspaces that have an explicit membership row.
-- "approved" remains for backward compatibility but is no longer an access gate.
create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
set row_security = off
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;

-- Users may read only their own membership rows. Other workspace data continues
-- to use is_workspace_member(workspace_id), which now enforces real membership.
drop policy if exists "workspace members read own workspace" on public.workspace_members;
drop policy if exists "workspace members read own membership" on public.workspace_members;
create policy "workspace members read own membership"
on public.workspace_members
for select
to authenticated
using (user_id = auth.uid());

-- Internal idempotent provisioner. It is used by the signup trigger and by the
-- one-time repair block below. It is not callable by normal app users.
drop function if exists public.provision_scout_user(uuid);
create function public.provision_scout_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_admin_email constant text := 'oyekunleolalekan3168@gmail.com';
  v_admin_workspace constant uuid := '00000000-0000-4000-8000-000000000001';
  v_email text;
  v_full_name text;
  v_is_admin boolean;
  v_workspace_id uuid;
  v_app_url text;
  v_render_backend_url text;
  v_dork_settings jsonb;
  v_extension_settings jsonb;
begin
  select
    lower(coalesce(u.email, '')),
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '')
  into v_email, v_full_name
  from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception 'Scout user % does not exist in auth.users', p_user_id;
  end if;

  v_is_admin := v_email = v_admin_email;

  insert into public.profiles (id, email, full_name, role, status)
  values (
    p_user_id,
    v_email,
    v_full_name,
    case when v_is_admin then 'admin' else 'member' end,
    'approved'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      role = excluded.role,
      status = 'approved',
      updated_at = now();

  -- Keep the existing admin workspace and its data/settings.
  insert into public.workspaces (id, name, owner_id)
  values (v_admin_workspace, 'Elevate Scout Team', case when v_is_admin then p_user_id else null end)
  on conflict (id) do update
  set owner_id = case
        when v_is_admin then p_user_id
        else public.workspaces.owner_id
      end,
      updated_at = now();

  if v_is_admin then
    v_workspace_id := v_admin_workspace;

    insert into public.workspace_members (workspace_id, user_id, role, approved)
    values (v_workspace_id, p_user_id, 'admin', true)
    on conflict (workspace_id, user_id) do update
    set role = 'admin', approved = true;

    -- The main admin remains the only admin role in the system.
    update public.workspace_members
    set role = 'member', approved = true
    where user_id = p_user_id
      and workspace_id <> v_admin_workspace
      and (role <> 'member' or approved is distinct from true);
  else
    -- Regular users must never inherit access to the admin workspace.
    delete from public.workspace_members
    where user_id = p_user_id
      and workspace_id = v_admin_workspace;

    -- Prefer an existing workspace already owned by this user so all existing
    -- businesses/messages/templates remain attached to the same workspace.
    select w.id
    into v_workspace_id
    from public.workspaces w
    where w.owner_id = p_user_id
      and w.id <> v_admin_workspace
    order by w.created_at asc
    limit 1;

    -- Recover an older owner-less personal workspace only when this user already
    -- has the membership. Never take ownership of another user's workspace.
    if v_workspace_id is null then
      select w.id
      into v_workspace_id
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = p_user_id
        and w.id <> v_admin_workspace
        and w.owner_id is null
      order by w.created_at asc
      limit 1;
    end if;

    if v_workspace_id is null then
      select
        w.app_url,
        w.render_backend_url,
        coalesce(w.dork_settings, '{}'::jsonb),
        coalesce(w.extension_settings, '{}'::jsonb)
      into v_app_url, v_render_backend_url, v_dork_settings, v_extension_settings
      from public.workspaces w
      where w.id = v_admin_workspace;

      insert into public.workspaces (
        name,
        owner_id,
        app_url,
        render_backend_url,
        dork_settings,
        extension_settings
      )
      values (
        'Scout Workspace - ' || coalesce(v_email, p_user_id::text),
        p_user_id,
        v_app_url,
        v_render_backend_url,
        coalesce(v_dork_settings, '{}'::jsonb),
        coalesce(v_extension_settings, '{}'::jsonb)
      )
      returning id into v_workspace_id;
    else
      update public.workspaces
      set owner_id = p_user_id,
          updated_at = now()
      where id = v_workspace_id
        and owner_id is null;
    end if;

    insert into public.workspace_members (workspace_id, user_id, role, approved)
    values (v_workspace_id, p_user_id, 'member', true)
    on conflict (workspace_id, user_id) do update
    set role = 'member', approved = true;

    -- Correct every historical regular-user membership that was wrongly marked admin.
    update public.workspace_members
    set role = 'member', approved = true
    where user_id = p_user_id
      and workspace_id <> v_admin_workspace
      and (role <> 'member' or approved is distinct from true);
  end if;

  return v_workspace_id;
end;
$$;

revoke all on function public.provision_scout_user(uuid) from public, anon, authenticated;
grant execute on function public.provision_scout_user(uuid) to service_role;

-- Future signups: create profile + private workspace + member role immediately.
-- The optional admin notification can fail without cancelling a valid signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
declare
  v_workspace_id uuid;
  v_full_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '');
begin
  v_workspace_id := public.provision_scout_user(new.id);

  if lower(coalesce(new.email, '')) <> 'oyekunleolalekan3168@gmail.com' then
    begin
      insert into public.app_notifications (
        workspace_id, type, title, message, entity_type, entity_id, raw
      )
      values (
        '00000000-0000-4000-8000-000000000001',
        'new_signup',
        'New Scout signup',
        case when v_full_name is not null
          then v_full_name || ' (' || coalesce(new.email, 'no email') || ') created a Scout account.'
          else coalesce(new.email, 'A new user') || ' created a Scout account.'
        end,
        'auth_user',
        new.id::text,
        jsonb_build_object(
          'name', v_full_name,
          'email', new.email,
          'user_id', new.id,
          'workspace_id', v_workspace_id
        )
      )
      on conflict do nothing;
    exception when others then
      raise warning 'Scout signup notification skipped: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- Recreate the trigger explicitly so it points to the corrected function.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Repair all existing Auth users once. This preserves valid existing workspaces
-- and creates only the three missing account workspaces found by the live audit.
do $$
declare
  r record;
begin
  for r in select id from auth.users order by created_at asc loop
    perform public.provision_scout_user(r.id);
  end loop;
end;
$$;

-- Read-only workspace resolver used by v10.33. It does not create or repair data.
drop function if exists public.current_scout_workspace();
create function public.current_scout_workspace()
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
  select
    w.id,
    w.name,
    w.api_key,
    w.app_url,
    w.render_backend_url,
    w.default_audience_category_id,
    w.default_audience_category_name,
    w.dork_settings,
    w.extension_settings,
    w.email_signature_text,
    w.email_signature_html,
    w.email_logo_url
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  join auth.users u on u.id = wm.user_id
  where wm.user_id = auth.uid()
  order by
    case
      when lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
       and w.id = '00000000-0000-4000-8000-000000000001' then 0
      when w.owner_id = wm.user_id then 1
      else 2
    end,
    wm.created_at asc
  limit 1;
$$;

revoke all on function public.current_scout_workspace() from public, anon;
grant execute on function public.current_scout_workspace() to authenticated, service_role;

-- Team Dashboard now returns one row for every Auth account, not one row per
-- workspace. It exposes only the count of connected sender accounts.
drop function if exists public.admin_team_sender_dashboard();
drop function if exists public.admin_team_dashboard();

create function public.admin_team_dashboard()
returns table (
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
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
set row_security = off
as $$
begin
  if not public.is_main_scout_admin() then
    raise exception 'Only the main Scout admin can read Team Dashboard';
  end if;

  return query
  with account_workspace as (
    select
      u.id as user_id,
      (
        select w.id
        from public.workspace_members wm
        join public.workspaces w on w.id = wm.workspace_id
        where wm.user_id = u.id
        order by
          case
            when lower(coalesce(u.email, '')) = 'oyekunleolalekan3168@gmail.com'
             and w.id = '00000000-0000-4000-8000-000000000001' then 0
            when w.owner_id = u.id then 1
            else 2
          end,
          wm.created_at asc
        limit 1
      ) as workspace_id
    from auth.users u
  )
  select
    u.id,
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      split_part(coalesce(u.email, ''), '@', 1)
    ) as full_name,
    u.email::text as user_email,
    w.id as workspace_id,
    w.name as workspace_name,
    coalesce((
      select count(*)
      from public.sent_messages sm
      where sm.workspace_id = w.id
        and coalesce(sm.status, '') in ('sent', 'delivered')
    ), 0)::bigint as lifetime_sent,
    coalesce((
      select count(*)
      from public.gmail_accounts ga
      where ga.workspace_id = w.id
        and coalesce(ga.status, '') in ('connected', 'active', 'ready')
    ), 0)::bigint as connected_senders,
    coalesce((
      select count(*) from public.businesses b where b.workspace_id = w.id
    ), 0)::bigint as total_leads,
    coalesce((
      select count(*)
      from public.businesses b
      where b.workspace_id = w.id
        and coalesce(b.status, '') in ('ready', 'found')
    ), 0)::bigint as ready_leads,
    coalesce((
      select count(*)
      from public.reply_history r
      where r.workspace_id = w.id
        and coalesce(r.is_real_reply, false) = true
    ), 0)::bigint as real_replies,
    coalesce((
      select count(*)
      from public.reply_history r
      where r.workspace_id = w.id
        and coalesce(r.is_auto_reply, false) = true
    ), 0)::bigint as auto_replies,
    coalesce((
      select count(*)
      from public.no_inbox_records n
      where n.workspace_id = w.id
    ), 0)::bigint as no_inbox_count,
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join account_workspace aw on aw.user_id = u.id
  left join public.workspaces w on w.id = aw.workspace_id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_team_dashboard() from public, anon;
grant execute on function public.admin_team_dashboard() to authenticated, service_role;

-- app_notifications was unrestricted in the live audit. Restrict it to the
-- signed-in user's workspace while preserving all existing app operations.
alter table public.app_notifications enable row level security;
drop policy if exists "app notifications member select" on public.app_notifications;
drop policy if exists "app notifications member insert" on public.app_notifications;
drop policy if exists "app notifications member update" on public.app_notifications;
drop policy if exists "app notifications member delete" on public.app_notifications;
create policy "app notifications member select"
on public.app_notifications for select to authenticated
using (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or user_id = auth.uid()
);
create policy "app notifications member insert"
on public.app_notifications for insert to authenticated
with check (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or user_id = auth.uid()
);
create policy "app notifications member update"
on public.app_notifications for update to authenticated
using (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or user_id = auth.uid()
)
with check (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or user_id = auth.uid()
);
create policy "app notifications member delete"
on public.app_notifications for delete to authenticated
using (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or user_id = auth.uid()
);


commit;

-- Verification result: this query should show exactly one admin profile, zero
-- missing profiles, zero missing memberships, and zero regular admin memberships.
select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'memberships', (select count(*) from public.workspace_members),
  'only_admin_email', (
    select jsonb_agg(p.email order by p.email)
    from public.profiles p
    where p.role = 'admin'
  ),
  'users_without_profile', (
    select count(*)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  ),
  'users_without_membership', (
    select count(*)
    from auth.users u
    where not exists (
      select 1 from public.workspace_members wm where wm.user_id = u.id
    )
  ),
  'regular_users_with_admin_membership', (
    select count(*)
    from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    where lower(coalesce(u.email, '')) <> 'oyekunleolalekan3168@gmail.com'
      and wm.role = 'admin'
  )
) as scout_v10_33_recovery_result;
