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

alter table public.sent_messages add column if not exists business_id uuid;
alter table public.sent_messages add column if not exists template_id uuid;
alter table public.sent_messages add column if not exists gmail_account_id uuid;
alter table public.sent_messages add column if not exists batch_id text;
alter table public.sent_messages add column if not exists to_email text;
alter table public.sent_messages add column if not exists from_email text;
alter table public.sent_messages add column if not exists subject text;
alter table public.sent_messages add column if not exists body text;
alter table public.sent_messages add column if not exists provider_message_id text;
alter table public.sent_messages add column if not exists gmail_thread_id text;
alter table public.sent_messages add column if not exists status text not null default 'sent';
alter table public.sent_messages add column if not exists delivery_status text;
alter table public.sent_messages add column if not exists error_code text;
alter table public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table public.sent_messages add column if not exists followup_due_at timestamptz;
alter table public.sent_messages add column if not exists last_reply_at timestamptz;
alter table public.sent_messages add column if not exists sent_at timestamptz not null default now();
alter table public.sent_messages add column if not exists raw jsonb not null default '{}'::jsonb;

create index if not exists sent_messages_workspace_sent_idx on public.sent_messages(workspace_id, sent_at desc);
create index if not exists sent_messages_workspace_thread_idx on public.sent_messages(workspace_id, gmail_thread_id);
create index if not exists sent_messages_workspace_to_email_idx on public.sent_messages(workspace_id, lower(to_email));
create index if not exists sent_messages_workspace_gmail_idx on public.sent_messages(workspace_id, gmail_account_id, sent_at desc);
create index if not exists sent_messages_workspace_template_idx on public.sent_messages(workspace_id, template_id, sent_at desc);

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
  is_real_reply boolean not null default false,
  received_at timestamptz not null default now(),
  gmail_message_id text,
  gmail_thread_id text,
  matched_status text,
  raw jsonb not null default '{}'::jsonb
);

alter table public.reply_history add column if not exists sent_message_id uuid;
alter table public.reply_history add column if not exists template_id uuid;
alter table public.reply_history add column if not exists gmail_account_id uuid;
alter table public.reply_history add column if not exists batch_id text;
alter table public.reply_history add column if not exists from_email text;
alter table public.reply_history add column if not exists to_email text;
alter table public.reply_history add column if not exists subject text;
alter table public.reply_history add column if not exists snippet text;
alter table public.reply_history add column if not exists body text;
alter table public.reply_history add column if not exists classification text;
alter table public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table public.reply_history add column if not exists received_at timestamptz not null default now();
alter table public.reply_history add column if not exists gmail_message_id text;
alter table public.reply_history add column if not exists gmail_thread_id text;
alter table public.reply_history add column if not exists matched_status text;
alter table public.reply_history add column if not exists raw jsonb not null default '{}'::jsonb;

create unique index if not exists reply_history_workspace_gmail_message_uid on public.reply_history(workspace_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists reply_history_workspace_real_idx on public.reply_history(workspace_id, is_real_reply, received_at desc);
create index if not exists reply_history_workspace_thread_idx on public.reply_history(workspace_id, gmail_thread_id);

create table if not exists public.no_inbox_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid,
  sent_message_id uuid,
  gmail_account_id uuid,
  template_id uuid,
  email text,
  reason text,
  gmail_message_id text,
  gmail_thread_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.no_inbox_records add column if not exists sent_message_id uuid;
alter table public.no_inbox_records add column if not exists gmail_account_id uuid;
alter table public.no_inbox_records add column if not exists template_id uuid;
alter table public.no_inbox_records add column if not exists email text;
alter table public.no_inbox_records add column if not exists reason text;
alter table public.no_inbox_records add column if not exists gmail_message_id text;
alter table public.no_inbox_records add column if not exists gmail_thread_id text;
alter table public.no_inbox_records add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.no_inbox_records add column if not exists created_at timestamptz not null default now();

create unique index if not exists no_inbox_records_workspace_gmail_message_uid on public.no_inbox_records(workspace_id, gmail_message_id) where gmail_message_id is not null;
create index if not exists no_inbox_records_workspace_created_idx on public.no_inbox_records(workspace_id, created_at desc);
create index if not exists no_inbox_records_workspace_email_idx on public.no_inbox_records(workspace_id, lower(email));

alter table public.gmail_accounts add column if not exists access_token text;
alter table public.gmail_accounts add column if not exists refresh_token text;
alter table public.gmail_accounts add column if not exists client_id text;
alter table public.gmail_accounts add column if not exists expires_at timestamptz;
alter table public.gmail_accounts add column if not exists last_error text;
alter table public.gmail_accounts add column if not exists updated_at timestamptz not null default now();

alter table public.sent_messages enable row level security;
alter table public.reply_history enable row level security;
alter table public.no_inbox_records enable row level security;

drop policy if exists sent_messages_member_all on public.sent_messages;
create policy sent_messages_member_all on public.sent_messages for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists reply_history_member_all on public.reply_history;
create policy reply_history_member_all on public.reply_history for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists no_inbox_records_member_all on public.no_inbox_records;
create policy no_inbox_records_member_all on public.no_inbox_records for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

select pg_notify('pgrst', 'reload schema');
