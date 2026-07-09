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

create table if not exists public.message_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  type text not null default 'initial',
  category_id uuid,
  template_id uuid,
  target_count int not null default 100,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  raw jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.message_schedules add column if not exists batch_id text;
alter table public.message_schedules add column if not exists processed_count int not null default 0;
alter table public.message_schedules add column if not exists sent_count int not null default 0;
alter table public.message_schedules add column if not exists failed_count int not null default 0;
alter table public.message_schedules add column if not exists skipped_count int not null default 0;
alter table public.message_schedules add column if not exists started_at timestamptz;
alter table public.message_schedules add column if not exists finished_at timestamptz;
alter table public.message_schedules add column if not exists last_error text;
alter table public.message_schedules add column if not exists updated_at timestamptz not null default now();
alter table public.message_schedules add column if not exists raw jsonb not null default '{}'::jsonb;

create index if not exists message_schedules_workspace_status_due_idx
on public.message_schedules(workspace_id, status, scheduled_for);

create table if not exists public.sent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid,
  template_id uuid,
  gmail_account_id uuid,
  batch_id text,
  to_email text,
  from_email text,
  subject text,
  body text,
  provider_message_id text,
  gmail_thread_id text,
  status text not null default 'sent',
  delivery_status text,
  error_code text,
  is_follow_up boolean not null default false,
  followup_due_at timestamptz,
  last_reply_at timestamptz,
  sent_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create table if not exists public.outreach_batches (
  id text primary key,
  workspace_id uuid not null,
  template_id uuid,
  requested_count int not null default 0,
  selected_sender_count int not null default 0,
  attempted_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  skipped_count int not null default 0,
  status text not null default 'running',
  raw jsonb not null default '{}'::jsonb,
  created_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  batch_id text,
  business_id uuid,
  template_id uuid,
  gmail_account_id uuid,
  type text not null default 'info',
  message text,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists sent_messages_workspace_sent_idx
on public.sent_messages(workspace_id, sent_at desc);

create index if not exists sent_messages_workspace_business_idx
on public.sent_messages(workspace_id, business_id, sent_at desc);

create index if not exists outreach_batches_workspace_created_idx
on public.outreach_batches(workspace_id, created_at desc);

create index if not exists outreach_events_workspace_batch_idx
on public.outreach_events(workspace_id, batch_id, created_at desc);

alter table public.message_schedules enable row level security;
alter table public.sent_messages enable row level security;
alter table public.outreach_batches enable row level security;
alter table public.outreach_events enable row level security;

drop policy if exists message_schedules_member_all on public.message_schedules;
create policy message_schedules_member_all
on public.message_schedules
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists sent_messages_member_all on public.sent_messages;
create policy sent_messages_member_all
on public.sent_messages
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists outreach_batches_member_all on public.outreach_batches;
create policy outreach_batches_member_all
on public.outreach_batches
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists outreach_events_member_all on public.outreach_events;
create policy outreach_events_member_all
on public.outreach_events
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

select pg_notify('pgrst', 'reload schema');
