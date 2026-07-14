-- Scout v10.29
-- Private workspace per user + admin notification on signup.
-- Run once in Supabase SQL editor. Safe to run again.

create extension if not exists pgcrypto;

alter table if exists public.workspaces add column if not exists owner_id uuid;
alter table if exists public.workspaces add column if not exists api_key text;
alter table if exists public.workspaces add column if not exists app_url text;
alter table if exists public.workspaces add column if not exists render_backend_url text;
alter table if exists public.workspaces add column if not exists default_audience_category_id uuid;
alter table if exists public.workspaces add column if not exists default_audience_category_name text;
alter table if exists public.workspaces add column if not exists dork_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists extension_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists email_signature_text text;
alter table if exists public.workspaces add column if not exists email_signature_html text;
alter table if exists public.workspaces add column if not exists email_logo_url text;
alter table if exists public.workspaces add column if not exists created_at timestamptz not null default now();
alter table if exists public.workspaces add column if not exists updated_at timestamptz not null default now();

update public.workspaces
set api_key = coalesce(nullif(api_key, ''), encode(gen_random_bytes(32), 'hex'))
where api_key is null or api_key = '';

create unique index if not exists workspaces_api_key_unique_idx on public.workspaces(api_key);
create index if not exists workspaces_owner_idx on public.workspaces(owner_id);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid,
  type text not null default 'info',
  title text not null default 'Notification',
  message text,
  entity_type text,
  entity_id text,
  business_id uuid,
  read_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_notifications_workspace_unread_idx
on public.app_notifications(workspace_id, read_at, created_at desc);

create unique index if not exists app_notifications_dedupe_idx
on public.app_notifications(workspace_id, type, entity_type, entity_id)
where entity_type is not null and entity_id is not null;

-- Replace the old trigger that placed every signup inside the same shared workspace.
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
    select * into source_workspace from public.workspaces where id = admin_workspace;

    insert into public.workspaces (
      name,
      owner_id,
      api_key,
      app_url,
      render_backend_url,
      default_audience_category_id,
      default_audience_category_name,
      dork_settings,
      extension_settings
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

    insert into public.workspace_members (workspace_id, user_id, role, approved)
    values (personal_workspace, new.id, 'admin', true)
    on conflict (workspace_id, user_id) do update set role = 'admin', approved = true;

    insert into public.app_notifications (
      workspace_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      raw
    )
    values (
      admin_workspace,
      'new_signup',
      'New Scout signup',
      coalesce(new.email, 'A new user') || ' created a new private Scout account.',
      'auth_user',
      new.id::text,
      jsonb_build_object('email', new.email, 'user_id', new.id, 'workspace_id', personal_workspace)
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Repair existing accounts that were previously sharing the admin workspace.
do $$
declare
  admin_email text := 'oyekunleolalekan3168@gmail.com';
  admin_workspace uuid := '00000000-0000-4000-8000-000000000001';
  source_workspace public.workspaces%rowtype;
  u record;
  personal_workspace uuid;
begin
  insert into public.workspaces (id, name, api_key)
  values (admin_workspace, 'Oyeola Scout Admin', encode(gen_random_bytes(32), 'hex'))
  on conflict (id) do nothing;

  select * into source_workspace from public.workspaces where id = admin_workspace;

  for u in
    select id, email
    from auth.users
    where lower(coalesce(email, '')) <> admin_email
  loop
    select w.id into personal_workspace
    from public.workspaces w
    join public.workspace_members wm on wm.workspace_id = w.id and wm.user_id = u.id
    where w.id <> admin_workspace
    order by w.created_at asc
    limit 1;

    if personal_workspace is null then
      insert into public.workspaces (
        name,
        owner_id,
        api_key,
        app_url,
        render_backend_url,
        default_audience_category_id,
        default_audience_category_name,
        dork_settings,
        extension_settings
      )
      values (
        'Scout Workspace - ' || coalesce(u.email, u.id::text),
        u.id,
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
    values (personal_workspace, u.id, 'admin', true)
    on conflict (workspace_id, user_id) do update set role = 'admin', approved = true;

    delete from public.workspace_members
    where workspace_id = admin_workspace
      and user_id = u.id;
  end loop;

  update public.profiles
  set role = case when lower(coalesce(email, '')) = admin_email then 'admin' else 'member' end,
      status = 'approved',
      updated_at = now();
end $$;

notify pgrst, 'reload schema';
