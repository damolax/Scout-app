-- Scout v8.49 reliable schedule / lightweight cron support
-- Safe to run more than once.

alter table if exists public.message_schedules
add column if not exists run_kind text not null default 'scheduled';

alter table if exists public.message_schedules
add column if not exists last_heartbeat_at timestamptz;

alter table if exists public.message_schedules
add column if not exists started_at timestamptz;

alter table if exists public.message_schedules
add column if not exists finished_at timestamptz;

alter table if exists public.message_schedules
add column if not exists stopped_at timestamptz;

alter table if exists public.message_schedules
add column if not exists stop_requested boolean not null default false;

alter table if exists public.message_schedules
add column if not exists processed_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists sent_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists failed_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists skipped_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists last_error text;

alter table if exists public.message_schedules
add column if not exists resume_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists updated_at timestamptz not null default now();

alter table if exists public.message_schedules
add column if not exists raw jsonb not null default '{}'::jsonb;

create index if not exists message_schedules_due_light_idx
on public.message_schedules(workspace_id, status, scheduled_for)
where status = 'scheduled';

create index if not exists businesses_workspace_status_location_idx
on public.businesses(workspace_id, status, location);

notify pgrst, 'reload schema';
