-- Immediate fix for: ERROR 42703: column ms.processed_count does not exist
-- Run this in Supabase SQL Editor, then run the v8.33/v8.35 migrations again.

alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();

create or replace function public.get_active_scout_jobs(target_workspace uuid)
returns table(
  job_type text,
  job_id text,
  status text,
  total_count int,
  processed_count int,
  sent_count int,
  failed_count int,
  skipped_count int,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    'message_schedule'::text as job_type,
    ms.id::text as job_id,
    ms.status,
    coalesce(ms.target_count, 0)::int as total_count,
    coalesce(ms.processed_count, 0)::int as processed_count,
    coalesce(ms.sent_count, 0)::int as sent_count,
    coalesce(ms.failed_count, 0)::int as failed_count,
    coalesce(ms.skipped_count, 0)::int as skipped_count,
    ms.created_at,
    ms.updated_at
  from public.message_schedules ms
  where ms.workspace_id = target_workspace
    and ms.status in ('scheduled','due','running')
  union all
  select
    'auto_scout'::text as job_type,
    erj.id::text as job_id,
    erj.status,
    1::int as total_count,
    case when erj.status in ('done','failed','cancelled') then 1 else 0 end::int as processed_count,
    case when erj.status = 'done' then 1 else 0 end::int as sent_count,
    case when erj.status = 'failed' then 1 else 0 end::int as failed_count,
    case when erj.status = 'cancelled' then 1 else 0 end::int as skipped_count,
    erj.created_at,
    erj.updated_at
  from public.email_research_jobs erj
  where erj.workspace_id = target_workspace
    and erj.status in ('queued','running')
  order by updated_at desc;
$$;
