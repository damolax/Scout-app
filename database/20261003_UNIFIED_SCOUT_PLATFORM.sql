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
