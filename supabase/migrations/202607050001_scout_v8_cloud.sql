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
      case when coalesce(nullif(d.email, ''), '') <> '' then 'ready' else 'pending' end,
      case when coalesce(nullif(d.email, ''), '') <> '' then 75 else null end,
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


create or replace function public.delete_pending_no_email_businesses(target_workspace uuid)
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

  delete from public.businesses
  where workspace_id = target_workspace
    and status in ('pending','scanning','found','review')
    and coalesce(nullif(email, ''), '') = '';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.delete_pending_no_email_businesses(uuid) to authenticated;

create or replace function public.mark_ready_emails_and_pending_no_email(target_workspace uuid)
returns table(ready_count int, pending_count int)
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

  -- Recover emails from old imports where the parser stored the raw CSV row but left businesses.email blank.
  update public.businesses
  set
    email = lower((regexp_match(
      concat_ws(' ',
        raw->>'email', raw->>'Email', raw->>'emails', raw->>'Emails',
        raw->>'email1', raw->>'email2', raw->>'email3',
        raw->>'validatedEmail1', raw->>'validatedEmail2', raw->>'validatedEmail3',
        raw->>'business email', raw->>'Business Email', raw->>'personal email', raw->>'Personal Email',
        raw->>'found email', raw->>'Found Email', raw->>'owner email', raw->>'Owner Email'
      ),
      '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'
    ))[1]),
    updated_at = now()
  where workspace_id = target_workspace
    and coalesce(nullif(email, ''), '') = ''
    and regexp_match(
      concat_ws(' ',
        raw->>'email', raw->>'Email', raw->>'emails', raw->>'Emails',
        raw->>'email1', raw->>'email2', raw->>'email3',
        raw->>'validatedEmail1', raw->>'validatedEmail2', raw->>'validatedEmail3',
        raw->>'business email', raw->>'Business Email', raw->>'personal email', raw->>'Personal Email',
        raw->>'found email', raw->>'Found Email', raw->>'owner email', raw->>'Owner Email'
      ),
      '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'
    ) is not null;

  update public.businesses
  set status = 'ready', score = coalesce(score, 75), updated_at = now()
  where workspace_id = target_workspace
    and coalesce(nullif(email, ''), '') <> ''
    and status in ('pending','found','review');

  update public.businesses
  set status = 'pending', updated_at = now()
  where workspace_id = target_workspace
    and coalesce(nullif(email, ''), '') = ''
    and status in ('found','review','ready');

  return query
  select
    (select count(*)::int from public.businesses where workspace_id = target_workspace and status = 'ready' and coalesce(nullif(email, ''), '') <> '') as ready_count,
    (select count(*)::int from public.businesses where workspace_id = target_workspace and status = 'pending' and coalesce(nullif(email, ''), '') = '') as pending_count;
end;
$$;

grant execute on function public.mark_ready_emails_and_pending_no_email(uuid) to authenticated;


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

-- v8.6 Native Outreach Engine additions.
alter table public.templates add column if not exists subject_variants text[] not null default '{}';
alter table public.templates add column if not exists active boolean not null default true;
alter table public.templates add column if not exists updated_at timestamptz not null default now();

drop trigger if exists templates_touch_updated_at on public.templates;
create trigger templates_touch_updated_at before update on public.templates for each row execute function public.touch_updated_at();

alter table public.gmail_accounts add column if not exists access_token text;
alter table public.gmail_accounts add column if not exists refresh_token text;
alter table public.gmail_accounts add column if not exists client_id text;
alter table public.gmail_accounts add column if not exists expires_at timestamptz;
alter table public.gmail_accounts add column if not exists daily_limit int not null default 400;
alter table public.gmail_accounts add column if not exists sent_today int not null default 0;
alter table public.gmail_accounts add column if not exists paused_until timestamptz;
alter table public.gmail_accounts add column if not exists last_error text;
alter table public.gmail_accounts add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.gmail_accounts add column if not exists updated_at timestamptz not null default now();

drop trigger if exists gmail_accounts_touch_updated_at on public.gmail_accounts;
create trigger gmail_accounts_touch_updated_at before update on public.gmail_accounts for each row execute function public.touch_updated_at();

create index if not exists gmail_accounts_workspace_status_idx on public.gmail_accounts(workspace_id, status, paused_until);

create table if not exists public.outreach_batches (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid references public.templates(id) on delete set null,
  requested_count int not null default 0,
  selected_sender_count int not null default 0,
  attempted_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  skipped_count int not null default 0,
  status text not null default 'running',
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outreach_batches_workspace_created_idx on public.outreach_batches(workspace_id, created_at desc);
create index if not exists outreach_batches_workspace_status_idx on public.outreach_batches(workspace_id, status, created_at desc);

drop trigger if exists outreach_batches_touch_updated_at on public.outreach_batches;
create trigger outreach_batches_touch_updated_at before update on public.outreach_batches for each row execute function public.touch_updated_at();

create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id text references public.outreach_batches(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  type text not null default 'info',
  message text,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists outreach_events_workspace_batch_idx on public.outreach_events(workspace_id, batch_id, created_at desc);
create index if not exists outreach_events_workspace_type_idx on public.outreach_events(workspace_id, type, created_at desc);

alter table public.sent_messages add column if not exists template_id uuid references public.templates(id) on delete set null;
alter table public.sent_messages add column if not exists gmail_account_id uuid references public.gmail_accounts(id) on delete set null;
alter table public.sent_messages add column if not exists batch_id text references public.outreach_batches(id) on delete set null;
alter table public.sent_messages add column if not exists gmail_thread_id text;
alter table public.sent_messages add column if not exists delivery_status text;
alter table public.sent_messages add column if not exists error_code text;

create index if not exists sent_messages_workspace_template_idx on public.sent_messages(workspace_id, template_id, sent_at desc);
create index if not exists sent_messages_workspace_gmail_idx on public.sent_messages(workspace_id, gmail_account_id, sent_at desc);
create index if not exists sent_messages_workspace_batch_idx on public.sent_messages(workspace_id, batch_id, sent_at desc);

alter table public.reply_history add column if not exists sent_message_id uuid references public.sent_messages(id) on delete set null;
alter table public.reply_history add column if not exists template_id uuid references public.templates(id) on delete set null;
alter table public.reply_history add column if not exists gmail_account_id uuid references public.gmail_accounts(id) on delete set null;
alter table public.reply_history add column if not exists batch_id text references public.outreach_batches(id) on delete set null;

create index if not exists reply_history_workspace_template_idx on public.reply_history(workspace_id, template_id, received_at desc);
create index if not exists reply_history_workspace_gmail_idx on public.reply_history(workspace_id, gmail_account_id, received_at desc);
create index if not exists reply_history_workspace_real_idx on public.reply_history(workspace_id, is_real_reply, received_at desc);

alter table public.outreach_batches enable row level security;
alter table public.outreach_events enable row level security;

drop policy if exists "outreach_batches select member" on public.outreach_batches;
create policy "outreach_batches select member" on public.outreach_batches for select using (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_batches insert member" on public.outreach_batches;
create policy "outreach_batches insert member" on public.outreach_batches for insert with check (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_batches update member" on public.outreach_batches;
create policy "outreach_batches update member" on public.outreach_batches for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_batches delete member" on public.outreach_batches;
create policy "outreach_batches delete member" on public.outreach_batches for delete using (public.is_workspace_member(workspace_id));

drop policy if exists "outreach_events select member" on public.outreach_events;
create policy "outreach_events select member" on public.outreach_events for select using (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_events insert member" on public.outreach_events;
create policy "outreach_events insert member" on public.outreach_events for insert with check (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_events update member" on public.outreach_events;
create policy "outreach_events update member" on public.outreach_events for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "outreach_events delete member" on public.outreach_events;
create policy "outreach_events delete member" on public.outreach_events for delete using (public.is_workspace_member(workspace_id));

create or replace function public.reset_gmail_daily_counts(target_workspace uuid)
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

  update public.gmail_accounts
  set sent_today = 0,
      paused_until = null,
      last_error = null,
      status = case when status = 'limit_hit' then 'connected' else status end,
      updated_at = now()
  where workspace_id = target_workspace;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.reset_gmail_daily_counts(uuid) to authenticated;

-- v8.7 Reply Tracking + Import Parser Fix support.
alter table public.reply_history add column if not exists gmail_message_id text;
alter table public.reply_history add column if not exists gmail_thread_id text;
alter table public.reply_history add column if not exists direction text not null default 'received';
alter table public.reply_history add column if not exists matched_status text;

create unique index if not exists reply_history_workspace_gmail_message_unique on public.reply_history(workspace_id, gmail_message_id);
create index if not exists reply_history_workspace_thread_idx on public.reply_history(workspace_id, gmail_thread_id, received_at desc);
create index if not exists reply_history_workspace_classification_idx on public.reply_history(workspace_id, classification, received_at desc);

alter table public.no_inbox_records add column if not exists sent_message_id uuid references public.sent_messages(id) on delete set null;
alter table public.no_inbox_records add column if not exists gmail_account_id uuid references public.gmail_accounts(id) on delete set null;
alter table public.no_inbox_records add column if not exists template_id uuid references public.templates(id) on delete set null;
alter table public.no_inbox_records add column if not exists gmail_message_id text;
alter table public.no_inbox_records add column if not exists gmail_thread_id text;

create index if not exists no_inbox_records_workspace_email_idx on public.no_inbox_records(workspace_id, email, created_at desc);
create index if not exists no_inbox_records_workspace_template_idx on public.no_inbox_records(workspace_id, template_id, created_at desc);
create index if not exists no_inbox_records_workspace_gmail_idx on public.no_inbox_records(workspace_id, gmail_account_id, created_at desc);

alter table public.sent_messages add column if not exists last_reply_at timestamptz;

create or replace view public.template_response_performance as
select
  t.workspace_id,
  t.id as template_id,
  t.name as template_name,
  count(distinct s.id) filter (where s.status = 'sent') as sent_count,
  count(distinct r.id) filter (where r.is_real_reply = true) as real_reply_count,
  count(distinct r.id) filter (where r.is_real_reply = false) as ignored_reply_count,
  case when count(distinct r.id) filter (where r.is_real_reply = true) > 0
    then round((count(distinct s.id) filter (where s.status = 'sent'))::numeric / (count(distinct r.id) filter (where r.is_real_reply = true))::numeric, 2)
    else null
  end as emails_per_reply
from public.templates t
left join public.sent_messages s on s.template_id = t.id and s.workspace_id = t.workspace_id
left join public.reply_history r on r.template_id = t.id and r.workspace_id = t.workspace_id
group by t.workspace_id, t.id, t.name;

-- v8.15 Message Library, scheduling, and follow-up support.
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

create index if not exists message_categories_workspace_name_idx on public.message_categories(workspace_id, name);

alter table public.templates add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table public.templates add column if not exists category_name text;
alter table public.templates add column if not exists purpose text;
create index if not exists templates_workspace_category_idx on public.templates(workspace_id, category_id, active, created_at desc);

alter table public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table public.sent_messages add column if not exists followup_due_at timestamptz;
create index if not exists sent_messages_workspace_followup_idx on public.sent_messages(workspace_id, is_follow_up, sent_at desc);

create table if not exists public.message_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null default 'initial' check (type in ('initial','follow_up')),
  category_id uuid references public.message_categories(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  target_count int not null default 100,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','due','running','sent','cancelled','failed')),
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_schedules_workspace_status_idx on public.message_schedules(workspace_id, status, scheduled_for);

drop trigger if exists message_categories_touch_updated_at on public.message_categories;
create trigger message_categories_touch_updated_at before update on public.message_categories for each row execute function public.touch_updated_at();

drop trigger if exists message_schedules_touch_updated_at on public.message_schedules;
create trigger message_schedules_touch_updated_at before update on public.message_schedules for each row execute function public.touch_updated_at();

alter table public.message_categories enable row level security;
alter table public.message_schedules enable row level security;

drop policy if exists "message_categories select member" on public.message_categories;
create policy "message_categories select member" on public.message_categories for select using (public.is_workspace_member(workspace_id));
drop policy if exists "message_categories insert member" on public.message_categories;
create policy "message_categories insert member" on public.message_categories for insert with check (public.is_workspace_member(workspace_id));
drop policy if exists "message_categories update member" on public.message_categories;
create policy "message_categories update member" on public.message_categories for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "message_categories delete member" on public.message_categories;
create policy "message_categories delete member" on public.message_categories for delete using (public.is_workspace_member(workspace_id));

drop policy if exists "message_schedules select member" on public.message_schedules;
create policy "message_schedules select member" on public.message_schedules for select using (public.is_workspace_member(workspace_id));
drop policy if exists "message_schedules insert member" on public.message_schedules;
create policy "message_schedules insert member" on public.message_schedules for insert with check (public.is_workspace_member(workspace_id));
drop policy if exists "message_schedules update member" on public.message_schedules;
create policy "message_schedules update member" on public.message_schedules for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "message_schedules delete member" on public.message_schedules;
create policy "message_schedules delete member" on public.message_schedules for delete using (public.is_workspace_member(workspace_id));

insert into public.message_categories (workspace_id, name, description)
values
  ('00000000-0000-4000-8000-000000000001', 'Airtable Google Map scouting', 'Messages for Airtable systems built from Google Maps/directories.'),
  ('00000000-0000-4000-8000-000000000001', 'Airtable Google Doc scouting', 'Messages for Airtable systems built from docs/sheets workflow gaps.'),
  ('00000000-0000-4000-8000-000000000001', 'Shopify design scouting', 'Messages focused on store design, trust, product page, and conversion flow.'),
  ('00000000-0000-4000-8000-000000000001', 'Shopify marketing scouting', 'Messages focused on traffic quality, email capture, abandoned cart, and retention.')
on conflict (workspace_id, name) do nothing;

create or replace function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100
)
returns table(
  business_id uuid,
  business_name text,
  to_email text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid
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
  with latest_sent as (
    select distinct on (s.business_id)
      s.business_id,
      s.to_email,
      s.sent_at,
      s.subject,
      s.template_id,
      s.gmail_account_id
    from public.sent_messages s
    where s.workspace_id = target_workspace
      and s.status = 'sent'
      and s.sent_at <= now() - interval '72 hours'
      and s.business_id is not null
    order by s.business_id, s.sent_at desc
  )
  select
    b.id as business_id,
    b.name as business_name,
    l.to_email,
    l.sent_at as last_sent_at,
    l.subject as last_subject,
    l.template_id,
    l.gmail_account_id
  from latest_sent l
  join public.businesses b on b.id = l.business_id and b.workspace_id = target_workspace
  where b.status = 'contacted'
    and coalesce(nullif(l.to_email, ''), '') <> ''
    and not exists (
      select 1 from public.reply_history r
      where r.workspace_id = target_workspace
        and r.business_id = b.id
        and r.is_real_reply = true
        and r.received_at >= l.sent_at
    )
    and not exists (
      select 1 from public.no_inbox_records n
      where n.workspace_id = target_workspace
        and (n.business_id = b.id or lower(coalesce(n.email, '')) = lower(l.to_email))
        and n.created_at >= l.sent_at
    )
  order by l.sent_at asc
  limit greatest(1, least(coalesce(limit_rows, 100), 5000));
end;
$$;

grant execute on function public.get_due_followups(uuid, int) to authenticated;

create or replace view public.sender_response_performance as
select
  g.workspace_id,
  g.id as gmail_account_id,
  g.email as sender_email,
  count(distinct s.id) filter (where s.status = 'sent') as sent_count,
  count(distinct r.id) filter (where r.is_real_reply = true) as real_reply_count,
  case when count(distinct r.id) filter (where r.is_real_reply = true) > 0
    then round((count(distinct s.id) filter (where s.status = 'sent'))::numeric / (count(distinct r.id) filter (where r.is_real_reply = true))::numeric, 2)
    else null
  end as emails_per_reply
from public.gmail_accounts g
left join public.sent_messages s on s.gmail_account_id = g.id and s.workspace_id = g.workspace_id
left join public.reply_history r on r.gmail_account_id = g.id and r.workspace_id = g.workspace_id
group by g.workspace_id, g.id, g.email;

-- v8.22 Sender settings limits, seed inbox tests, spam guard support.
alter table public.gmail_accounts add column if not exists account_type text not null default 'gmail';
alter table public.gmail_accounts add column if not exists default_run_limit int not null default 100;
alter table public.gmail_accounts add column if not exists seed_inbox_enabled boolean not null default false;
alter table public.gmail_accounts add column if not exists seed_test_address text;
alter table public.gmail_accounts add column if not exists spam_risk_status text;
alter table public.gmail_accounts add column if not exists last_seed_result text;
alter table public.gmail_accounts add column if not exists last_seed_checked_at timestamptz;

create table if not exists public.seed_inbox_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sender_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  seed_gmail_account_id uuid references public.gmail_accounts(id) on delete set null,
  sender_email text,
  seed_email text,
  subject text,
  placement text not null default 'sent_pending_check',
  checked_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seed_inbox_tests_workspace_created_idx on public.seed_inbox_tests(workspace_id, created_at desc);
create index if not exists seed_inbox_tests_sender_idx on public.seed_inbox_tests(workspace_id, sender_gmail_account_id, created_at desc);
create index if not exists gmail_accounts_workspace_seed_idx on public.gmail_accounts(workspace_id, seed_inbox_enabled, spam_risk_status);

alter table public.seed_inbox_tests enable row level security;
drop policy if exists "seed_inbox_tests select member" on public.seed_inbox_tests;
create policy "seed_inbox_tests select member" on public.seed_inbox_tests for select using (public.is_workspace_member(workspace_id));
drop policy if exists "seed_inbox_tests insert member" on public.seed_inbox_tests;
create policy "seed_inbox_tests insert member" on public.seed_inbox_tests for insert with check (public.is_workspace_member(workspace_id));
drop policy if exists "seed_inbox_tests update member" on public.seed_inbox_tests;
create policy "seed_inbox_tests update member" on public.seed_inbox_tests for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists "seed_inbox_tests delete member" on public.seed_inbox_tests;
create policy "seed_inbox_tests delete member" on public.seed_inbox_tests for delete using (public.is_workspace_member(workspace_id));


-- Ensure due follow-ups RPC exists for Message page.
create or replace function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100
)
returns table(
  business_id uuid,
  business_name text,
  to_email text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid
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
  with latest_sent as (
    select distinct on (s.business_id)
      s.business_id,
      s.to_email,
      s.sent_at,
      s.subject,
      s.template_id,
      s.gmail_account_id
    from public.sent_messages s
    where s.workspace_id = target_workspace
      and s.status = 'sent'
      and s.sent_at <= now() - interval '72 hours'
      and s.business_id is not null
    order by s.business_id, s.sent_at desc
  )
  select
    b.id as business_id,
    b.name as business_name,
    l.to_email,
    l.sent_at as last_sent_at,
    l.subject as last_subject,
    l.template_id,
    l.gmail_account_id
  from latest_sent l
  join public.businesses b on b.id = l.business_id and b.workspace_id = target_workspace
  where b.status = 'contacted'
    and coalesce(nullif(l.to_email, ''), '') <> ''
    and not exists (
      select 1 from public.reply_history r
      where r.workspace_id = target_workspace
        and r.business_id = b.id
        and r.is_real_reply = true
        and r.received_at >= l.sent_at
    )
    and not exists (
      select 1 from public.no_inbox_records n
      where n.workspace_id = target_workspace
        and (n.business_id = b.id or lower(coalesce(n.email, '')) = lower(l.to_email))
        and n.created_at >= l.sent_at
    )
  order by l.sent_at asc
  limit greatest(1, least(coalesce(limit_rows, 100), 5000));
end;
$$;

grant execute on function public.get_due_followups(uuid, int) to authenticated;

select pg_notify('pgrst', 'reload schema');
