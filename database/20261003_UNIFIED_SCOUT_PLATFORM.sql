-- Unified Scout Platform: multi-type prospects, native Opportunity Intelligence,
-- and SMTP/App-Password senders that reuse Scout's existing campaign worker.
-- Run after the current v10.42.x schema.

alter table public.businesses
  add column if not exists prospect_type text not null default 'business',
  add column if not exists qualification_score int,
  add column if not exists opportunity_score int,
  add column if not exists person_name text,
  add column if not exists role_title text;

create index if not exists businesses_workspace_prospect_type_idx
  on public.businesses(workspace_id, prospect_type, created_at desc);

alter table public.gmail_accounts
  add column if not exists auth_mode text not null default 'oauth',
  add column if not exists smtp_host text,
  add column if not exists smtp_port int,
  add column if not exists smtp_secure boolean not null default true,
  add column if not exists smtp_secret_ciphertext text,
  add column if not exists smtp_secret_iv text,
  add column if not exists smtp_secret_tag text,
  add column if not exists smtp_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gmail_accounts_auth_mode_check'
  ) then
    alter table public.gmail_accounts
      add constraint gmail_accounts_auth_mode_check
      check (auth_mode in ('oauth','smtp'));
  end if;
end $$;

create table if not exists public.scout_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  scout_type text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  background_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scout_profiles_workspace_type_idx
  on public.scout_profiles(workspace_id, scout_type, active);

create table if not exists public.scout_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid references public.scout_profiles(id) on delete set null,
  scout_type text not null,
  status text not null default 'queued'
    check (status in ('queued','running','paused','completed','failed','cancelled')),
  target_count int,
  discovered_count int not null default 0,
  checked_count int not null default 0,
  qualified_count int not null default 0,
  email_count int not null default 0,
  duplicate_count int not null default 0,
  progress_text text,
  filters jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scout_runs_workspace_status_idx
  on public.scout_runs(workspace_id, status, created_at desc);

create table if not exists public.scout_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.scout_runs(id) on delete cascade,
  prospect_type text not null,
  candidate_key text not null,
  name text,
  website text,
  email text,
  country text,
  source_url text,
  status text not null default 'discovered'
    check (status in ('discovered','checking','qualified','rejected','claimed','duplicate')),
  score int,
  evidence jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, candidate_key)
);

create index if not exists scout_candidates_workspace_status_idx
  on public.scout_candidates(workspace_id, prospect_type, status, created_at desc);

create table if not exists public.opportunity_scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  website text not null,
  hostname text not null,
  prospect_name text,
  status text not null default 'complete'
    check (status in ('running','complete','partial','failed')),
  industry text,
  subindustry text,
  opportunity_score int,
  readiness_score int,
  prospect_priority int,
  confidence int,
  analysis jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists opportunity_scans_workspace_created_idx
  on public.opportunity_scans(workspace_id, created_at desc);
create index if not exists opportunity_scans_business_idx
  on public.opportunity_scans(workspace_id, business_id, created_at desc);
create index if not exists opportunity_scans_hostname_idx
  on public.opportunity_scans(workspace_id, hostname, created_at desc);

alter table public.scout_profiles enable row level security;
alter table public.scout_runs enable row level security;
alter table public.scout_candidates enable row level security;
alter table public.opportunity_scans enable row level security;

drop policy if exists scout_profiles_members on public.scout_profiles;
create policy scout_profiles_members on public.scout_profiles
for all using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_profiles.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
) with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_profiles.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
);

drop policy if exists scout_runs_members on public.scout_runs;
create policy scout_runs_members on public.scout_runs
for all using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_runs.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
) with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_runs.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
);

drop policy if exists scout_candidates_members on public.scout_candidates;
create policy scout_candidates_members on public.scout_candidates
for all using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_candidates.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
) with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = scout_candidates.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
);

drop policy if exists opportunity_scans_members on public.opportunity_scans;
create policy opportunity_scans_members on public.opportunity_scans
for all using (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = opportunity_scans.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
) with check (
  exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = opportunity_scans.workspace_id
      and wm.user_id = auth.uid()
      and wm.approved = true
  )
);

drop trigger if exists touch_scout_profiles_updated_at on public.scout_profiles;
create trigger touch_scout_profiles_updated_at
before update on public.scout_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_scout_runs_updated_at on public.scout_runs;
create trigger touch_scout_runs_updated_at
before update on public.scout_runs
for each row execute function public.touch_updated_at();

drop trigger if exists touch_scout_candidates_updated_at on public.scout_candidates;
create trigger touch_scout_candidates_updated_at
before update on public.scout_candidates
for each row execute function public.touch_updated_at();


-- Durable background worker for non-author Scout runs.
-- Uses the same Supabase Cron + pg_net pattern as the existing message worker.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.configure_unified_scout_worker(
  target_app_url text,
  target_worker_secret text,
  target_seconds integer default 60
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
  safe_seconds := greatest(30, least(300, coalesce(target_seconds, 60)));

  if clean_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Scout worker app URL must be a valid HTTPS URL.';
  end if;
  if length(trim(coalesce(target_worker_secret, ''))) < 24 then
    raise exception 'Scout worker secret must contain at least 24 characters.';
  end if;

  select id into url_secret_id
  from vault.secrets
  where name = 'scout_background_worker_app_url'
  order by created_at desc
  limit 1;

  if url_secret_id is null then
    perform vault.create_secret(clean_url, 'scout_background_worker_app_url', 'Scout app URL used by the background prospect worker.');
  else
    perform vault.update_secret(url_secret_id, clean_url, 'scout_background_worker_app_url', 'Scout app URL used by the background prospect worker.');
  end if;

  select id into worker_secret_id
  from vault.secrets
  where name = 'scout_background_worker_secret'
  order by created_at desc
  limit 1;

  if worker_secret_id is null then
    perform vault.create_secret(trim(target_worker_secret), 'scout_background_worker_secret', 'Private authorization secret for the background prospect worker.');
  else
    perform vault.update_secret(worker_secret_id, trim(target_worker_secret), 'scout_background_worker_secret', 'Private authorization secret for the background prospect worker.');
  end if;

  worker_command := $worker$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scout_background_worker_app_url' order by created_at desc limit 1)
        || '/api/cron/scout-worker',
      body := jsonb_build_object(
        'limit', 1,
        'token', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_background_worker_secret' order by created_at desc limit 1)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_background_worker_secret' order by created_at desc limit 1)
      ),
      timeout_milliseconds := 55000
    ) as request_id;
  $worker$;

  for scheduled_job_id in
    select jobid from cron.job where jobname = 'scout-background-worker'
  loop
    perform cron.unschedule(scheduled_job_id);
  end loop;

  select cron.schedule(
    'scout-background-worker',
    safe_seconds::text || ' seconds',
    worker_command
  ) into scheduled_job_id;

  return jsonb_build_object(
    'ready', true,
    'job_id', scheduled_job_id,
    'job_name', 'scout-background-worker',
    'schedule', safe_seconds::text || ' seconds',
    'app_url', clean_url
  );
end;
$$;

revoke all on function public.configure_unified_scout_worker(text, text, integer) from public, anon, authenticated;
grant execute on function public.configure_unified_scout_worker(text, text, integer) to service_role;

create or replace function public.unified_scout_worker_status()
returns jsonb
language sql
security definer
set search_path = public, cron
as $$
  select coalesce((
    select jsonb_build_object(
      'ready', active,
      'job_id', jobid,
      'job_name', jobname,
      'schedule', schedule
    )
    from cron.job
    where jobname = 'scout-background-worker'
    order by jobid desc
    limit 1
  ), jsonb_build_object('ready', false, 'job_name', 'scout-background-worker'));
$$;

revoke all on function public.unified_scout_worker_status() from public, anon, authenticated;
grant execute on function public.unified_scout_worker_status() to service_role;


-- Record the unified platform contract only after all objects above are installed.
insert into public.scout_schema_versions(version, notes)
values (
  '10.43.0',
  'Unified Scout: multi-type background scouting, Opportunity Intelligence, SMTP/App-Password sending, author bridge, unified Prospects and Outreach.'
)
on conflict (version) do update
set applied_at = now(),
    notes = excluded.notes;
