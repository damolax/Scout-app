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
  access_token text,
  refresh_token text,
  client_id text,
  expires_at timestamptz,
  daily_limit int not null default 400,
  default_run_limit int not null default 100,
  sent_today int not null default 0,
  paused_until timestamptz,
  last_error text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, email)
);

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

create table if not exists public.reply_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid,
  sent_message_id uuid,
  template_id uuid,
  gmail_account_id uuid,
  batch_id text,
  from_email text,
  to_email text,
  subject text,
  snippet text,
  body text,
  classification text,
  reply_bucket text,
  is_real_reply boolean not null default false,
  is_auto_reply boolean not null default false,
  is_delivery_failure boolean not null default false,
  is_blocked boolean not null default false,
  is_limit_notice boolean not null default false,
  is_temporary boolean not null default false,
  received_at timestamptz not null default now(),
  gmail_message_id text,
  gmail_thread_id text,
  matched_status text,
  raw jsonb not null default '{}'::jsonb
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

alter table public.businesses add column if not exists reply_state text;
alter table public.businesses add column if not exists last_reply_classification text;
alter table public.businesses add column if not exists last_inbound_at timestamptz;
alter table public.businesses add column if not exists last_auto_reply_at timestamptz;
alter table public.businesses add column if not exists last_real_reply_at timestamptz;
alter table public.businesses add column if not exists last_manual_reply_at timestamptz;
alter table public.businesses add column if not exists social_links jsonb not null default '[]'::jsonb;

alter table public.reply_history add column if not exists reply_bucket text;
alter table public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table public.reply_history add column if not exists is_blocked boolean not null default false;
alter table public.reply_history add column if not exists is_limit_notice boolean not null default false;
alter table public.reply_history add column if not exists is_temporary boolean not null default false;
alter table public.reply_history add column if not exists matched_status text;

alter table public.no_inbox_records add column if not exists to_email text;
alter table public.no_inbox_records add column if not exists from_email text;
alter table public.no_inbox_records add column if not exists status text not null default 'no_inbox';
alter table public.no_inbox_records add column if not exists type text;
alter table public.no_inbox_records add column if not exists source text;
alter table public.no_inbox_records add column if not exists error_code text;
alter table public.no_inbox_records add column if not exists bounce_type text;
alter table public.no_inbox_records add column if not exists provider_message_id text;
alter table public.no_inbox_records add column if not exists subject text;
alter table public.no_inbox_records add column if not exists snippet text;
alter table public.no_inbox_records add column if not exists updated_at timestamptz not null default now();

alter table public.sent_messages add column if not exists last_reply_at timestamptz;
alter table public.sent_messages add column if not exists is_follow_up boolean not null default false;

create index if not exists businesses_workspace_reply_state_idx on public.businesses(workspace_id, reply_state, updated_at desc);
create index if not exists reply_history_workspace_bucket_idx on public.reply_history(workspace_id, reply_bucket, received_at desc);
create index if not exists reply_history_workspace_auto_idx on public.reply_history(workspace_id, is_auto_reply, received_at desc);
create index if not exists reply_history_workspace_delivery_idx on public.reply_history(workspace_id, is_delivery_failure, received_at desc);
create index if not exists reply_history_workspace_limit_idx on public.reply_history(workspace_id, is_limit_notice, received_at desc);
create index if not exists reply_history_workspace_business_idx on public.reply_history(workspace_id, business_id, received_at desc);
create unique index if not exists reply_history_workspace_gmail_message_uid on public.reply_history(workspace_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists sent_messages_workspace_business_idx on public.sent_messages(workspace_id, business_id, sent_at desc);
create index if not exists sent_messages_workspace_thread_idx on public.sent_messages(workspace_id, gmail_thread_id);
create index if not exists no_inbox_records_workspace_business_idx on public.no_inbox_records(workspace_id, business_id, created_at desc);
create unique index if not exists no_inbox_records_workspace_gmail_message_uid on public.no_inbox_records(workspace_id, gmail_message_id) where gmail_message_id is not null;

alter table public.gmail_accounts enable row level security;
alter table public.sent_messages enable row level security;
alter table public.reply_history enable row level security;
alter table public.no_inbox_records enable row level security;

drop policy if exists gmail_accounts_member_all on public.gmail_accounts;
create policy gmail_accounts_member_all on public.gmail_accounts for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists sent_messages_member_all on public.sent_messages;
create policy sent_messages_member_all on public.sent_messages for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists reply_history_member_all on public.reply_history;
create policy reply_history_member_all on public.reply_history for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists no_inbox_records_member_all on public.no_inbox_records;
create policy no_inbox_records_member_all on public.no_inbox_records for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

select pg_notify('pgrst', 'reload schema');
