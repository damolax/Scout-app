-- Scout v8.45 focused repair: schedule run kind + signature logo + sender display support

-- Message schedules: fixes “run_kind column missing” when saving/running scheduled jobs.
alter table if exists public.message_schedules
add column if not exists run_kind text not null default 'manual_now';

alter table if exists public.message_schedules
add column if not exists last_error text;

alter table if exists public.message_schedules
add column if not exists target_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists processed_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists sent_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists failed_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists skipped_count int not null default 0;

alter table if exists public.message_schedules
add column if not exists stop_requested boolean not null default false;

alter table if exists public.message_schedules
add column if not exists worker_options jsonb not null default '{}'::jsonb;

alter table if exists public.message_schedules
add column if not exists updated_at timestamptz not null default now();

create index if not exists message_schedules_workspace_run_kind_idx
on public.message_schedules(workspace_id, run_kind, status, scheduled_for);

-- Gmail sender settings: fixes saving sender settings and signature/logo state.
alter table if exists public.gmail_accounts
add column if not exists signature_logo_url text;

alter table if exists public.gmail_accounts
add column if not exists signature_enabled boolean not null default true;

alter table if exists public.gmail_accounts
add column if not exists signature_text text;

alter table if exists public.gmail_accounts
add column if not exists signature_html text;

alter table if exists public.gmail_accounts
add column if not exists sync_signature_to_gmail boolean not null default false;

alter table if exists public.gmail_accounts
add column if not exists gmail_signature_synced_at timestamptz;

alter table if exists public.gmail_accounts
add column if not exists gmail_signature_sync_error text;

alter table if exists public.gmail_accounts
add column if not exists default_run_limit int not null default 50;

alter table if exists public.gmail_accounts
add column if not exists daily_limit int not null default 450;

alter table if exists public.gmail_accounts
add column if not exists account_type text not null default 'gmail';

-- Match the app's simple sender type values.
alter table public.gmail_accounts drop constraint if exists gmail_accounts_account_type_check;
alter table public.gmail_accounts add constraint gmail_accounts_account_type_check
check (account_type in ('gmail', 'workspace', 'alias', 'other'));

update public.gmail_accounts
set account_type = 'other'
where account_type not in ('gmail', 'workspace', 'alias', 'other');

-- Workspace-level logo/signature storage for future fallback.
alter table if exists public.workspaces add column if not exists email_logo_url text;
alter table if exists public.workspaces add column if not exists email_signature_text text;
alter table if exists public.workspaces add column if not exists email_signature_html text;

notify pgrst, 'reload schema';
