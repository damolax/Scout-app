-- Scout v8.33 - persistent notifications and durable job support

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null default 'info',
  title text not null,
  message text,
  entity_type text,
  entity_id text,
  business_id uuid references public.businesses(id) on delete set null,
  read_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_notifications_workspace_created_idx
on public.app_notifications(workspace_id, created_at desc);

create index if not exists app_notifications_workspace_unread_idx
on public.app_notifications(workspace_id, read_at, created_at desc);

create unique index if not exists app_notifications_workspace_entity_type_unique
on public.app_notifications(workspace_id, type, entity_type, entity_id)
where entity_type is not null and entity_id is not null;

alter table public.app_notifications enable row level security;

drop policy if exists app_notifications_member_all on public.app_notifications;
create policy app_notifications_member_all
on public.app_notifications
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

alter table public.message_schedules add column if not exists run_kind text not null default 'scheduled';
alter table public.message_schedules add column if not exists last_heartbeat_at timestamptz;
alter table public.message_schedules add column if not exists resume_count int not null default 0;
alter table public.message_schedules add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.message_schedules add column if not exists target_count int not null default 0;
alter table public.message_schedules add column if not exists processed_count int not null default 0;
alter table public.message_schedules add column if not exists sent_count int not null default 0;
alter table public.message_schedules add column if not exists failed_count int not null default 0;
alter table public.message_schedules add column if not exists skipped_count int not null default 0;
alter table public.message_schedules add column if not exists updated_at timestamptz not null default now();

create index if not exists message_schedules_workspace_running_idx
on public.message_schedules(workspace_id, status, updated_at)
where status = 'running';

create index if not exists message_schedules_workspace_created_idx
on public.message_schedules(workspace_id, created_at desc);

-- Helper view-like function for UI cards. This is safe to re-run.
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
