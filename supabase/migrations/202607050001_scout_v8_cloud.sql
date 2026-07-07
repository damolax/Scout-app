create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'approved' check (status in ('approved','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  api_key text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.workspaces (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Elevate Scout Team')
on conflict (id) do nothing;

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_name text,
  row_count int not null default 0,
  inserted_count int not null default 0,
  skipped_count int not null default 0,
  headers text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  name text,
  email text,
  phone text,
  website text,
  domain text,
  category text,
  location text,
  source text not null default 'manual',
  status text not null default 'pending' check (status in ('pending','scanning','found','ready','review','contacted','responded','no_inbox','bounced','invalid','duplicate','archived')),
  score int,
  normalized_key text not null,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_key)
);

create index if not exists businesses_workspace_status_idx on public.businesses(workspace_id, status);
create index if not exists businesses_workspace_created_idx on public.businesses(workspace_id, created_at desc);
create index if not exists businesses_workspace_email_idx on public.businesses(workspace_id, email);
create index if not exists businesses_workspace_updated_idx on public.businesses(workspace_id, updated_at desc);

create table if not exists public.scout_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_key text not null,
  email text,
  domain text,
  website text,
  name text,
  phone text,
  source text not null default 'scout_app',
  campaign text,
  status text not null default 'scouted',
  raw jsonb not null default '{}'::jsonb,
  scouted_by uuid references auth.users(id) on delete set null,
  scouted_at timestamptz not null default now(),
  unique (workspace_id, normalized_key)
);

create index if not exists scout_history_workspace_key_idx on public.scout_history(workspace_id, normalized_key);

create table if not exists public.email_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  email text not null,
  source text,
  score int,
  status text not null default 'candidate',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists email_candidates_workspace_business_email_unique on public.email_candidates(workspace_id, business_id, email);
create index if not exists email_candidates_workspace_status_idx on public.email_candidates(workspace_id, status, created_at desc);

create table if not exists public.sent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  to_email text not null,
  from_email text,
  subject text,
  body text,
  provider_message_id text,
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.reply_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  from_email text,
  to_email text,
  subject text,
  snippet text,
  body text,
  classification text,
  is_real_reply boolean not null default true,
  received_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.no_inbox_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  email text,
  reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  subject text not null,
  message text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);


create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  display_name text,
  status text not null default 'connected',
  backend_ref text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(workspace_id, email)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null default 'info',
  message text not null,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_research_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  priority int not null default 100,
  attempts int not null default 0,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, business_id)
);

create index if not exists email_research_jobs_workspace_status_idx on public.email_research_jobs(workspace_id, status, priority desc, created_at);
create index if not exists email_research_jobs_business_idx on public.email_research_jobs(business_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at before update on public.workspaces for each row execute function public.touch_updated_at();

drop trigger if exists businesses_touch_updated_at on public.businesses;
create trigger businesses_touch_updated_at before update on public.businesses for each row execute function public.touch_updated_at();

drop trigger if exists email_research_jobs_touch_updated_at on public.email_research_jobs;
create trigger email_research_jobs_touch_updated_at before update on public.email_research_jobs for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text := 'oyekunleolalekan3168@gmail.com';
  default_workspace uuid := '00000000-0000-4000-8000-000000000001';
  new_role text;
begin
  new_role := case when lower(new.email) = admin_email then 'admin' else 'member' end;

  insert into public.profiles (id, email, role, status)
  values (new.id, new.email, new_role, 'approved')
  on conflict (id) do update set email = excluded.email, role = excluded.role, status = 'approved';

  insert into public.workspace_members (workspace_id, user_id, role, approved)
  values (default_workspace, new.id, new_role, true)
  on conflict (workspace_id, user_id) do update set role = excluded.role, approved = true;

  if new_role = 'admin' then
    update public.workspaces set owner_id = new.id where id = default_workspace;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and approved = true
  );
$$;


create or replace function public.check_existing_normalized_keys(
  target_workspace uuid,
  normalized_keys text[]
)
returns table(normalized_key text, source text)
language sql
security definer
set search_path = public
stable
as $$
  select b.normalized_key, 'queue'::text as source
  from public.businesses b
  where b.workspace_id = target_workspace
    and b.normalized_key = any(normalized_keys)
  union
  select h.normalized_key, 'scout_history'::text as source
  from public.scout_history h
  where h.workspace_id = target_workspace
    and h.normalized_key = any(normalized_keys);
$$;

grant execute on function public.check_existing_normalized_keys(uuid, text[]) to authenticated;

create or replace function public.import_businesses_chunk(
  target_workspace uuid,
  target_batch_id uuid,
  input_rows jsonb
)
returns table(inserted_count int, skipped_queue_count int, skipped_history_count int, skipped_keys text[])
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
  with incoming as (
    select
      nullif(trim(x.name), '') as name,
      nullif(trim(lower(x.email)), '') as email,
      nullif(trim(x.phone), '') as phone,
      nullif(trim(x.website), '') as website,
      nullif(trim(x.domain), '') as domain,
      nullif(trim(x.category), '') as category,
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
    select distinct on (normalized_key) *
    from incoming
    order by normalized_key
  ),
  queue_existing as (
    select d.normalized_key
    from deduped d
    join public.businesses b
      on b.workspace_id = target_workspace
     and b.normalized_key = d.normalized_key
  ),
  history_existing as (
    select d.normalized_key
    from deduped d
    join public.scout_history h
      on h.workspace_id = target_workspace
     and h.normalized_key = d.normalized_key
    where not exists (select 1 from queue_existing q where q.normalized_key = d.normalized_key)
  ),
  skipped as (
    select normalized_key from queue_existing
    union
    select normalized_key from history_existing
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
      d.name,
      d.email,
      d.phone,
      d.website,
      d.domain,
      d.category,
      d.location,
      d.source,
      'pending',
      null,
      d.normalized_key,
      d.raw,
      auth.uid()
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

grant execute on function public.import_businesses_chunk(uuid, uuid, jsonb) to authenticated;

create or replace function public.archive_empty_businesses(target_workspace uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

  update public.businesses
  set status = 'archived', updated_at = now()
  where workspace_id = target_workspace
    and status in ('pending','scanning','found','ready','review')
    and coalesce(nullif(email, ''), '') = ''
    and coalesce(nullif(website, ''), '') = ''
    and coalesce(nullif(domain, ''), '') = '';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.archive_empty_businesses(uuid) to authenticated;


alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.import_batches enable row level security;
alter table public.businesses enable row level security;
alter table public.scout_history enable row level security;
alter table public.email_candidates enable row level security;
alter table public.sent_messages enable row level security;
alter table public.reply_history enable row level security;
alter table public.no_inbox_records enable row level security;
alter table public.templates enable row level security;
alter table public.gmail_accounts enable row level security;
alter table public.activity_logs enable row level security;
alter table public.email_research_jobs enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select using (id = auth.uid());

drop policy if exists "workspaces read member" on public.workspaces;
create policy "workspaces read member" on public.workspaces for select using (public.is_workspace_member(id));

drop policy if exists "workspace members read own workspace" on public.workspace_members;
create policy "workspace members read own workspace" on public.workspace_members for select using (public.is_workspace_member(workspace_id));

-- Workspace data policies.
do $$
declare
  t text;
begin
  foreach t in array array['import_batches','businesses','scout_history','email_candidates','sent_messages','reply_history','no_inbox_records','templates','gmail_accounts','activity_logs','email_research_jobs'] loop
    execute format('drop policy if exists %I on public.%I', t || ' select member', t);
    execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', t || ' select member', t);
    execute format('drop policy if exists %I on public.%I', t || ' insert member', t);
    execute format('create policy %I on public.%I for insert with check (public.is_workspace_member(workspace_id))', t || ' insert member', t);
    execute format('drop policy if exists %I on public.%I', t || ' update member', t);
    execute format('create policy %I on public.%I for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t || ' update member', t);
    execute format('drop policy if exists %I on public.%I', t || ' delete member', t);
    execute format('create policy %I on public.%I for delete using (public.is_workspace_member(workspace_id))', t || ' delete member', t);
  end loop;
end $$;
