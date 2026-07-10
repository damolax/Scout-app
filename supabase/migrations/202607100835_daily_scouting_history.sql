-- Scout v8.35 - daily scouting submission history and migration safety fixes

-- Safety patch for installs that jumped directly to v8.33/v8.34 and missed older schedule columns.
alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();

create table if not exists public.daily_scouting_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scout_date date not null default current_date,
  submitted_by uuid references auth.users(id) on delete set null,
  submitter_email text,
  scout_name text,
  niche text,
  location text,
  country text,
  source_mode text not null default 'mixed',
  notes text,
  raw_text text,
  parsed_count int not null default 0,
  inserted_count int not null default 0,
  skipped_count int not null default 0,
  direct_email_count int not null default 0,
  website_only_count int not null default 0,
  queued_auto_scout_count int not null default 0,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  status text not null default 'submitted',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_scouting_submissions add column if not exists scout_date date not null default current_date;
alter table public.daily_scouting_submissions add column if not exists submitted_by uuid references auth.users(id) on delete set null;
alter table public.daily_scouting_submissions add column if not exists submitter_email text;
alter table public.daily_scouting_submissions add column if not exists scout_name text;
alter table public.daily_scouting_submissions add column if not exists niche text;
alter table public.daily_scouting_submissions add column if not exists location text;
alter table public.daily_scouting_submissions add column if not exists country text;
alter table public.daily_scouting_submissions add column if not exists source_mode text not null default 'mixed';
alter table public.daily_scouting_submissions add column if not exists notes text;
alter table public.daily_scouting_submissions add column if not exists raw_text text;
alter table public.daily_scouting_submissions add column if not exists parsed_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists inserted_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists skipped_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists direct_email_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists website_only_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists queued_auto_scout_count int not null default 0;
alter table public.daily_scouting_submissions add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.daily_scouting_submissions add column if not exists status text not null default 'submitted';
alter table public.daily_scouting_submissions add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.daily_scouting_submissions add column if not exists updated_at timestamptz not null default now();

create index if not exists daily_scouting_submissions_workspace_date_idx
on public.daily_scouting_submissions(workspace_id, scout_date desc, created_at desc);

create index if not exists daily_scouting_submissions_workspace_submitter_idx
on public.daily_scouting_submissions(workspace_id, submitted_by, scout_date desc);

alter table public.daily_scouting_submissions enable row level security;

drop policy if exists daily_scouting_submissions_member_all on public.daily_scouting_submissions;
create policy daily_scouting_submissions_member_all
on public.daily_scouting_submissions
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop trigger if exists daily_scouting_submissions_touch_updated_at on public.daily_scouting_submissions;
create trigger daily_scouting_submissions_touch_updated_at
before update on public.daily_scouting_submissions
for each row execute function public.touch_updated_at();

create or replace function public.get_daily_scouting_totals(target_workspace uuid, target_date date default current_date)
returns table(
  submitter_email text,
  scout_name text,
  submissions int,
  parsed_count int,
  inserted_count int,
  direct_email_count int,
  website_only_count int,
  queued_auto_scout_count int,
  last_submitted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(dss.submitter_email, ''), 'unknown') as submitter_email,
    coalesce(nullif(dss.scout_name, ''), coalesce(nullif(dss.submitter_email, ''), 'Unknown scout')) as scout_name,
    count(*)::int as submissions,
    coalesce(sum(dss.parsed_count), 0)::int as parsed_count,
    coalesce(sum(dss.inserted_count), 0)::int as inserted_count,
    coalesce(sum(dss.direct_email_count), 0)::int as direct_email_count,
    coalesce(sum(dss.website_only_count), 0)::int as website_only_count,
    coalesce(sum(dss.queued_auto_scout_count), 0)::int as queued_auto_scout_count,
    max(dss.created_at) as last_submitted_at
  from public.daily_scouting_submissions dss
  where dss.workspace_id = target_workspace
    and dss.scout_date = target_date
  group by 1, 2
  order by inserted_count desc, parsed_count desc, last_submitted_at desc;
$$;
