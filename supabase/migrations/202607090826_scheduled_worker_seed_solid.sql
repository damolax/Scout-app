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

create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  email text not null,
  display_name text,
  status text not null default 'connected',
  backend_ref text,
  access_token text,
  refresh_token text,
  client_id text,
  expires_at timestamptz,
  daily_limit int not null default 400,
  sent_today int not null default 0,
  paused_until timestamptz,
  last_error text,
  account_type text not null default 'gmail',
  default_run_limit int not null default 100,
  seed_inbox_enabled boolean not null default false,
  seed_test_address text,
  spam_risk_status text,
  last_seed_result text,
  last_seed_checked_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table public.gmail_accounts add column if not exists account_type text not null default 'gmail';
alter table public.gmail_accounts add column if not exists default_run_limit int not null default 100;
alter table public.gmail_accounts add column if not exists seed_inbox_enabled boolean not null default false;
alter table public.gmail_accounts add column if not exists seed_test_address text;
alter table public.gmail_accounts add column if not exists spam_risk_status text;
alter table public.gmail_accounts add column if not exists last_seed_result text;
alter table public.gmail_accounts add column if not exists last_seed_checked_at timestamptz;
alter table public.gmail_accounts add column if not exists sent_today int not null default 0;
alter table public.gmail_accounts add column if not exists daily_limit int not null default 400;
alter table public.gmail_accounts add column if not exists paused_until timestamptz;
alter table public.gmail_accounts add column if not exists last_error text;
alter table public.gmail_accounts add column if not exists access_token text;
alter table public.gmail_accounts add column if not exists refresh_token text;
alter table public.gmail_accounts add column if not exists expires_at timestamptz;
alter table public.gmail_accounts add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.gmail_accounts add column if not exists updated_at timestamptz not null default now();

create index if not exists gmail_accounts_workspace_seed_idx
on public.gmail_accounts(workspace_id, seed_inbox_enabled, spam_risk_status);

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
alter table public.message_schedules add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.message_schedules add column if not exists updated_at timestamptz not null default now();

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

alter table public.sent_messages add column if not exists delivery_status text;
alter table public.sent_messages add column if not exists error_code text;
alter table public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table public.sent_messages add column if not exists followup_due_at timestamptz;
alter table public.sent_messages add column if not exists last_reply_at timestamptz;
alter table public.sent_messages add column if not exists raw jsonb not null default '{}'::jsonb;

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

create table if not exists public.no_inbox_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid,
  sent_message_id uuid,
  gmail_account_id uuid,
  template_id uuid,
  email text,
  to_email text,
  from_email text,
  reason text not null default 'no_inbox',
  status text not null default 'no_inbox',
  type text,
  source text,
  error_code text,
  bounce_type text,
  provider_message_id text,
  gmail_message_id text,
  gmail_thread_id text,
  subject text,
  snippet text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sent_messages_workspace_sent_idx
on public.sent_messages(workspace_id, sent_at desc);
create index if not exists sent_messages_workspace_business_idx
on public.sent_messages(workspace_id, business_id, sent_at desc);
create index if not exists outreach_batches_workspace_created_idx
on public.outreach_batches(workspace_id, created_at desc);
create index if not exists outreach_events_workspace_batch_idx
on public.outreach_events(workspace_id, batch_id, created_at desc);
create index if not exists no_inbox_records_workspace_email_idx
on public.no_inbox_records(workspace_id, lower(coalesce(email, to_email, '')));

alter table public.gmail_accounts enable row level security;
alter table public.seed_inbox_tests enable row level security;
alter table public.message_schedules enable row level security;
alter table public.sent_messages enable row level security;
alter table public.outreach_batches enable row level security;
alter table public.outreach_events enable row level security;
alter table public.no_inbox_records enable row level security;

drop policy if exists gmail_accounts_member_all on public.gmail_accounts;
create policy gmail_accounts_member_all on public.gmail_accounts for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists seed_inbox_tests_member_all on public.seed_inbox_tests;
create policy seed_inbox_tests_member_all on public.seed_inbox_tests for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists message_schedules_member_all on public.message_schedules;
create policy message_schedules_member_all on public.message_schedules for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists sent_messages_member_all on public.sent_messages;
create policy sent_messages_member_all on public.sent_messages for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists outreach_batches_member_all on public.outreach_batches;
create policy outreach_batches_member_all on public.outreach_batches for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists outreach_events_member_all on public.outreach_events;
create policy outreach_events_member_all on public.outreach_events for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists no_inbox_records_member_all on public.no_inbox_records;
create policy no_inbox_records_member_all on public.no_inbox_records for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create or replace function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100
)
returns table(
  business_id uuid,
  business_name text,
  to_email text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with latest_sent as (
    select distinct on (s.business_id)
      s.business_id,
      s.to_email,
      s.sent_at,
      s.subject,
      s.template_id,
      s.gmail_account_id
    from public.sent_messages s
    where s.workspace_id = target_workspace
      and s.status = 'sent'
      and coalesce(s.is_follow_up, false) = false
      and s.sent_at <= now() - interval '72 hours'
      and s.business_id is not null
    order by s.business_id, s.sent_at desc
  )
  select
    b.id as business_id,
    b.name as business_name,
    l.to_email,
    l.sent_at as last_sent_at,
    l.subject as last_subject,
    l.template_id,
    l.gmail_account_id
  from latest_sent l
  join public.businesses b on b.id = l.business_id and b.workspace_id = target_workspace
  where b.status = 'contacted'
    and coalesce(nullif(l.to_email, ''), '') <> ''
    and not exists (
      select 1 from public.reply_history r
      where r.workspace_id = target_workspace
        and r.business_id = b.id
        and coalesce(r.is_real_reply, false) = true
        and r.received_at >= l.sent_at
    )
    and not exists (
      select 1 from public.no_inbox_records n
      where n.workspace_id = target_workspace
        and (n.business_id = b.id or lower(coalesce(n.email, n.to_email, '')) = lower(l.to_email))
        and n.created_at >= l.sent_at
    )
  order by l.sent_at asc
  limit greatest(1, least(coalesce(limit_rows, 100), 5000));
end;
$$;

grant execute on function public.get_due_followups(uuid, int) to authenticated;

select pg_notify('pgrst', 'reload schema');
