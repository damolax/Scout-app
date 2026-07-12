-- Scout v10.6 cleanup, redetect, schedule delete, notifications delete

alter table if exists public.email_research_jobs
add column if not exists raw jsonb not null default '{}'::jsonb;

alter table if exists public.message_schedules
add column if not exists stopped_at timestamptz;

alter table if exists public.message_schedules
add column if not exists stop_requested boolean not null default false;

alter table if exists public.message_schedules
add column if not exists updated_at timestamptz not null default now();

alter table if exists public.app_notifications
add column if not exists business_id uuid;

notify pgrst, 'reload schema';
