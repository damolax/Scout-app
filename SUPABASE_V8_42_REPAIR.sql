-- Scout v8.42 repair: notifications, schedules, signatures/logo, categories, follow-ups, and schema cache reload.
-- Run once in Supabase SQL Editor after deploying v8.42.

create extension if not exists pgcrypto;

-- Notifications bell
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid,
  type text not null default 'info',
  title text not null,
  message text,
  entity_type text,
  entity_id text,
  business_id uuid,
  read_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_notifications add column if not exists workspace_id uuid;
alter table public.app_notifications add column if not exists user_id uuid;
alter table public.app_notifications add column if not exists type text not null default 'info';
alter table public.app_notifications add column if not exists title text not null default 'Notification';
alter table public.app_notifications add column if not exists message text;
alter table public.app_notifications add column if not exists entity_type text;
alter table public.app_notifications add column if not exists entity_id text;
alter table public.app_notifications add column if not exists business_id uuid;
alter table public.app_notifications add column if not exists read_at timestamptz;
alter table public.app_notifications add column if not exists raw jsonb not null default '{}'::jsonb;
alter table public.app_notifications add column if not exists created_at timestamptz not null default now();
create unique index if not exists app_notifications_dedupe_idx on public.app_notifications(workspace_id, type, entity_type, entity_id) where entity_type is not null and entity_id is not null;
create index if not exists app_notifications_workspace_unread_idx on public.app_notifications(workspace_id, read_at, created_at desc);

alter table public.app_notifications enable row level security;
drop policy if exists app_notifications_member_all on public.app_notifications;
create policy app_notifications_member_all on public.app_notifications for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.app_notifications to authenticated;

-- Message schedules: durable sending, progress, stop button, and worker recovery.
alter table if exists public.message_schedules add column if not exists run_kind text;
alter table if exists public.message_schedules add column if not exists category_id uuid;
alter table if exists public.message_schedules add column if not exists audience_category_id uuid;
alter table if exists public.message_schedules add column if not exists audience_category_name text;
alter table if exists public.message_schedules add column if not exists template_id uuid;
alter table if exists public.message_schedules add column if not exists followup_segment text;
alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists batch_id text;
alter table if exists public.message_schedules add column if not exists raw jsonb not null default '{}'::jsonb;
alter table if exists public.message_schedules add column if not exists worker_options jsonb not null default '{}'::jsonb;
alter table if exists public.message_schedules add column if not exists last_error text;
alter table if exists public.message_schedules add column if not exists started_at timestamptz;
alter table if exists public.message_schedules add column if not exists finished_at timestamptz;
alter table if exists public.message_schedules add column if not exists completed_at timestamptz;
alter table if exists public.message_schedules add column if not exists last_heartbeat_at timestamptz;
alter table if exists public.message_schedules add column if not exists stop_requested boolean not null default false;
alter table if exists public.message_schedules add column if not exists stopped_at timestamptz;
alter table if exists public.message_schedules add column if not exists resume_count int not null default 0;
alter table if exists public.message_schedules add column if not exists created_by uuid;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();

-- Gmail sender identity/signature columns. Scout-local signatures do not require reconnecting Gmail.
alter table if exists public.gmail_accounts add column if not exists signature_enabled boolean not null default true;
alter table if exists public.gmail_accounts add column if not exists signature_text text;
alter table if exists public.gmail_accounts add column if not exists signature_html text;
alter table if exists public.gmail_accounts add column if not exists signature_logo_url text;
alter table if exists public.gmail_accounts add column if not exists sync_signature_to_gmail boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_synced_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_sync_error text;
alter table if exists public.gmail_accounts add column if not exists default_run_limit int;
alter table if exists public.gmail_accounts add column if not exists daily_limit int not null default 450;
alter table if exists public.gmail_accounts add column if not exists sent_today int not null default 0;
alter table if exists public.gmail_accounts add column if not exists last_error text;
alter table if exists public.gmail_accounts add column if not exists paused_until timestamptz;
alter table if exists public.gmail_accounts add column if not exists updated_at timestamptz not null default now();

-- Workspace/admin setup columns used by simplified Settings and extension.
alter table if exists public.workspaces add column if not exists app_url text;
alter table if exists public.workspaces add column if not exists render_backend_url text;
alter table if exists public.workspaces add column if not exists default_audience_category_id uuid;
alter table if exists public.workspaces add column if not exists default_audience_category_name text;
alter table if exists public.workspaces add column if not exists dork_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists extension_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists updated_at timestamptz not null default now();

create table if not exists public.message_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

insert into public.message_categories (workspace_id, name, description, active)
select w.id, 'Airtable', 'Audience/template category for Airtable-related outreach.', true from public.workspaces w
on conflict (workspace_id, name) do nothing;
insert into public.message_categories (workspace_id, name, description, active)
select w.id, 'Shopify', 'Audience/template category for Shopify-related outreach.', true from public.workspaces w
on conflict (workspace_id, name) do nothing;

alter table if exists public.businesses add column if not exists category_id uuid;
alter table if exists public.businesses add column if not exists category_name text;
alter table if exists public.businesses add column if not exists reply_state text;
alter table if exists public.businesses add column if not exists last_real_reply_at timestamptz;
alter table if exists public.businesses add column if not exists last_auto_reply_at timestamptz;
alter table if exists public.businesses add column if not exists last_inbound_at timestamptz;

alter table if exists public.import_batches add column if not exists category_id uuid;
alter table if exists public.import_batches add column if not exists category_name text;
alter table if exists public.import_batches add column if not exists source_mode text;

alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table if exists public.reply_history add column if not exists is_blocked boolean not null default false;
alter table if exists public.reply_history add column if not exists is_limit_notice boolean not null default false;
alter table if exists public.reply_history add column if not exists is_temporary boolean not null default false;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists received_at timestamptz;
alter table if exists public.reply_history add column if not exists gmail_message_id text;
alter table if exists public.reply_history add column if not exists gmail_thread_id text;

alter table if exists public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table if exists public.sent_messages add column if not exists gmail_thread_id text;
alter table if exists public.sent_messages add column if not exists delivery_status text;
alter table if exists public.sent_messages add column if not exists error_code text;
alter table if exists public.sent_messages add column if not exists last_reply_at timestamptz;
alter table if exists public.sent_messages add column if not exists raw jsonb not null default '{}'::jsonb;

create index if not exists message_schedules_workspace_status_due_idx on public.message_schedules(workspace_id, status, scheduled_for);
create index if not exists message_schedules_workspace_stop_idx on public.message_schedules(workspace_id, stop_requested, status);
create index if not exists sent_messages_workspace_business_sent_idx on public.sent_messages(workspace_id, business_id, sent_at desc);
create index if not exists reply_history_workspace_business_received_idx on public.reply_history(workspace_id, business_id, received_at desc);
create index if not exists businesses_workspace_category_status_idx on public.businesses(workspace_id, category_id, status, updated_at desc);
create unique index if not exists reply_history_workspace_gmail_message_uid on public.reply_history(workspace_id, gmail_message_id) where gmail_message_id is not null;

-- Follow-up RPC used by Message, Dashboard, Automation, and worker.
create or replace function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100,
  followup_segment text default 'all_unanswered'
)
returns table (
  business_id uuid,
  business_name text,
  to_email text,
  website text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid,
  followup_segment text,
  reply_state text,
  last_auto_reply_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with last_sent as (
    select distinct on (sm.business_id)
      sm.business_id,
      sm.sent_at,
      sm.subject,
      sm.template_id,
      sm.gmail_account_id
    from public.sent_messages sm
    where sm.workspace_id = target_workspace
      and sm.status in ('sent', 'delivered', 'dry_run')
    order by sm.business_id, sm.sent_at desc nulls last
  ), reply_flags as (
    select
      rh.business_id,
      bool_or(coalesce(rh.is_real_reply, false)) as has_real_reply,
      bool_or(coalesce(rh.is_auto_reply, false)) as has_auto_reply,
      bool_or(coalesce(rh.is_delivery_failure, false) or coalesce(rh.is_blocked, false)) as has_bad_inbox,
      max(case when coalesce(rh.is_auto_reply, false) then rh.received_at else null end) as auto_reply_at
    from public.reply_history rh
    where rh.workspace_id = target_workspace
    group by rh.business_id
  )
  select
    b.id as business_id,
    coalesce(b.name, '') as business_name,
    coalesce(b.email, '') as to_email,
    coalesce(b.website, '') as website,
    ls.sent_at as last_sent_at,
    ls.subject as last_subject,
    ls.template_id,
    ls.gmail_account_id,
    case when coalesce(rf.has_auto_reply, false) then 'auto_reply' else 'no_reply' end as followup_segment,
    case when coalesce(rf.has_auto_reply, false) then 'auto_reply' else 'no_reply' end as reply_state,
    rf.auto_reply_at as last_auto_reply_at
  from public.businesses b
  join last_sent ls on ls.business_id = b.id
  left join reply_flags rf on rf.business_id = b.id
  where b.workspace_id = target_workspace
    and coalesce(b.email, '') <> ''
    and coalesce(b.status, '') not in ('responded', 'bad_inbox', 'bounced', 'no_inbox', 'blocked', 'invalid', 'duplicate', 'archived')
    and ls.sent_at <= now() - interval '72 hours'
    and coalesce(rf.has_real_reply, false) = false
    and coalesce(rf.has_bad_inbox, false) = false
    and (
      $3 in ('all', 'all_unanswered', '')
      or ($3 = 'no_reply' and coalesce(rf.has_auto_reply, false) = false)
      or ($3 = 'auto_reply' and coalesce(rf.has_auto_reply, false) = true)
    )
  order by ls.sent_at asc
  limit greatest(1, limit_rows);
$$;

grant execute on function public.get_due_followups(uuid, int, text) to authenticated;

-- Reset schema cache for PostgREST/Supabase API.
notify pgrst, 'reload schema';
