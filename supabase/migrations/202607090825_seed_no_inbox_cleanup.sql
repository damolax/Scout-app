
-- v8.24.1 cleanup: prevent own connected Gmail accounts from appearing as No Inbox prospects.
-- Run after v8.24/v8.24.1 deploy if your No Inbox page shows your own sender/seed Gmail.

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

-- Remove false No Inbox rows where the failed email is one of your connected Gmail accounts.
delete from public.no_inbox_records n
using public.gmail_accounts g
where n.workspace_id = g.workspace_id
  and lower(coalesce(n.email, '')) = lower(coalesce(g.email, ''));

-- Deduplicate repeated Gmail delivery notices.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by workspace_id, gmail_message_id
      order by created_at desc
    ) as rn
  from public.no_inbox_records
  where coalesce(gmail_message_id, '') <> ''
)
delete from public.no_inbox_records n
using ranked r
where n.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists no_inbox_records_workspace_gmail_message_uid
on public.no_inbox_records(workspace_id, gmail_message_id)
where gmail_message_id is not null;

select pg_notify('pgrst', 'reload schema');
