-- Scout v8.47 schedule/live activity repair
-- Adds columns used by durable sending and live progress. Safe to run more than once.

alter table if exists public.message_schedules add column if not exists run_kind text not null default 'manual_now';
alter table if exists public.message_schedules add column if not exists last_error text;
alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists started_at timestamptz;
alter table if exists public.message_schedules add column if not exists finished_at timestamptz;
alter table if exists public.message_schedules add column if not exists completed_at timestamptz;
alter table if exists public.message_schedules add column if not exists stopped_at timestamptz;
alter table if exists public.message_schedules add column if not exists stop_requested boolean not null default false;
alter table if exists public.message_schedules add column if not exists worker_options jsonb not null default '{}'::jsonb;
alter table if exists public.message_schedules add column if not exists last_heartbeat_at timestamptz;
alter table if exists public.message_schedules add column if not exists resume_count int not null default 0;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();
alter table if exists public.message_schedules add column if not exists batch_id text;
alter table if exists public.message_schedules add column if not exists audience_category_id uuid;
alter table if exists public.message_schedules add column if not exists audience_category_name text;
alter table if exists public.message_schedules add column if not exists followup_segment text;

create index if not exists message_schedules_workspace_due_idx
on public.message_schedules(workspace_id, status, scheduled_for);

notify pgrst, 'reload schema';
