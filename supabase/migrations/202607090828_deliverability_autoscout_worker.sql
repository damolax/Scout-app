-- v8.28 deliverability + Auto Scout worker support
-- No destructive changes. This makes sure the worker/dashboard tables and indexes exist.

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null;
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to anon;

create table if not exists public.email_research_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid not null,
  status text not null default 'queued',
  priority int not null default 100,
  attempts int not null default 0,
  last_error text,
  result jsonb,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(workspace_id, business_id)
);

alter table public.email_research_jobs add column if not exists priority int not null default 100;
alter table public.email_research_jobs add column if not exists attempts int not null default 0;
alter table public.email_research_jobs add column if not exists last_error text;
alter table public.email_research_jobs add column if not exists result jsonb;
alter table public.email_research_jobs add column if not exists requested_by uuid;
alter table public.email_research_jobs add column if not exists updated_at timestamptz not null default now();
alter table public.email_research_jobs add column if not exists started_at timestamptz;
alter table public.email_research_jobs add column if not exists finished_at timestamptz;

create index if not exists email_research_jobs_workspace_status_idx
on public.email_research_jobs(workspace_id, status, priority desc, created_at asc);

create index if not exists email_research_jobs_stale_running_idx
on public.email_research_jobs(status, updated_at)
where status = 'running';

create table if not exists public.seed_inbox_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  sender_gmail_account_id uuid,
  seed_gmail_account_id uuid,
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

create index if not exists seed_inbox_tests_workspace_created_idx
on public.seed_inbox_tests(workspace_id, created_at desc);

create index if not exists seed_inbox_tests_sender_idx
on public.seed_inbox_tests(workspace_id, sender_gmail_account_id, created_at desc);

do $$
begin
  if to_regclass('public.sent_messages') is not null then
    create index if not exists sent_messages_workspace_sender_time_idx
    on public.sent_messages(workspace_id, from_email, sent_at desc);
  end if;

  if to_regclass('public.reply_history') is not null then
    create index if not exists reply_history_workspace_received_idx
    on public.reply_history(workspace_id, received_at desc);
  end if;

  if to_regclass('public.no_inbox_records') is not null then
    create index if not exists no_inbox_records_workspace_from_created_idx
    on public.no_inbox_records(workspace_id, from_email, created_at desc);
  end if;
end $$;

alter table public.email_research_jobs enable row level security;
alter table public.seed_inbox_tests enable row level security;

drop policy if exists email_research_jobs_member_all on public.email_research_jobs;
create policy email_research_jobs_member_all
on public.email_research_jobs
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists seed_inbox_tests_member_all on public.seed_inbox_tests;
create policy seed_inbox_tests_member_all
on public.seed_inbox_tests
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

select pg_notify('pgrst', 'reload schema');
