-- SCOUT v10.40.0 schema-health and signature repair.
-- Safe for the existing Scout database. It is idempotent and does not delete data.

create extension if not exists pgcrypto;

-- The v10.40 application reads these workspace fields, but the earlier upgrade
-- file did not add the three signature fields to every historical installation.
alter table if exists public.workspaces add column if not exists app_url text;
alter table if exists public.workspaces add column if not exists timezone text not null default 'UTC';
alter table if exists public.workspaces add column if not exists default_audience_category_id uuid;
alter table if exists public.workspaces add column if not exists default_audience_category_name text;
alter table if exists public.workspaces add column if not exists dork_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists extension_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists email_signature_text text;
alter table if exists public.workspaces add column if not exists email_signature_html text;
alter table if exists public.workspaces add column if not exists email_logo_url text;
alter table if exists public.workspaces add column if not exists updated_at timestamptz not null default now();

-- Reconcile fields used by the stricter runtime schema contract. These are
-- ADD COLUMN IF NOT EXISTS repairs only; existing values are preserved.
alter table if exists public.gmail_accounts add column if not exists signature_enabled boolean not null default true;
alter table if exists public.gmail_accounts add column if not exists signature_text text;
alter table if exists public.gmail_accounts add column if not exists signature_html text;
alter table if exists public.gmail_accounts add column if not exists signature_logo_url text;
alter table if exists public.gmail_accounts add column if not exists sync_signature_to_gmail boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_synced_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_sync_error text;
alter table if exists public.gmail_accounts add column if not exists granted_scopes text[] not null default '{}';
alter table if exists public.gmail_accounts add column if not exists oauth_reconnect_required boolean not null default true;
alter table if exists public.gmail_accounts add column if not exists last_reply_sync_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists last_reply_sync_status text;
alter table if exists public.gmail_accounts add column if not exists last_reply_sync_error text;
alter table if exists public.gmail_accounts add column if not exists last_reply_message_id text;
alter table if exists public.gmail_accounts add column if not exists last_reply_history_id text;
alter table if exists public.gmail_accounts add column if not exists raw jsonb not null default '{}'::jsonb;
alter table if exists public.gmail_accounts add column if not exists updated_at timestamptz not null default now();

alter table if exists public.businesses add column if not exists reply_state text;
alter table if exists public.businesses add column if not exists last_reply_classification text;
alter table if exists public.businesses add column if not exists last_inbound_at timestamptz;
alter table if exists public.businesses add column if not exists last_auto_reply_at timestamptz;
alter table if exists public.businesses add column if not exists last_real_reply_at timestamptz;
alter table if exists public.businesses add column if not exists email_verification_status text not null default 'unchecked';
alter table if exists public.businesses add column if not exists email_verification_level text;
alter table if exists public.businesses add column if not exists email_verified_at timestamptz;
alter table if exists public.businesses add column if not exists email_verification_reason text;
alter table if exists public.businesses add column if not exists email_role_label text;
alter table if exists public.businesses add column if not exists email_mx_hosts text[] not null default '{}';

alter table if exists public.templates add column if not exists body text;
alter table if exists public.templates add column if not exists template_type text not null default 'initial';
alter table if exists public.templates add column if not exists active boolean not null default true;
alter table if exists public.templates add column if not exists raw jsonb not null default '{}'::jsonb;
update public.templates set body = coalesce(body, message, '') where body is null;

alter table if exists public.sent_messages add column if not exists template_id uuid;
alter table if exists public.sent_messages add column if not exists gmail_account_id uuid;
alter table if exists public.sent_messages add column if not exists delivery_status text;
alter table if exists public.sent_messages add column if not exists gmail_message_id text;
alter table if exists public.sent_messages add column if not exists gmail_thread_id text;
alter table if exists public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table if exists public.sent_messages add column if not exists follow_up_stage integer;
alter table if exists public.sent_messages add column if not exists raw jsonb not null default '{}'::jsonb;

alter table if exists public.reply_history add column if not exists sent_message_id uuid;
alter table if exists public.reply_history add column if not exists template_id uuid;
alter table if exists public.reply_history add column if not exists gmail_account_id uuid;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table if exists public.reply_history add column if not exists is_no_inbox boolean not null default false;
alter table if exists public.reply_history add column if not exists is_blocked boolean not null default false;
alter table if exists public.reply_history add column if not exists is_limit_notice boolean not null default false;
alter table if exists public.reply_history add column if not exists is_temporary boolean not null default false;
alter table if exists public.reply_history add column if not exists gmail_message_id text;
alter table if exists public.reply_history add column if not exists gmail_thread_id text;
alter table if exists public.reply_history add column if not exists raw jsonb not null default '{}'::jsonb;

alter table if exists public.no_inbox_records add column if not exists status text;
alter table if exists public.no_inbox_records add column if not exists bounce_type text;
alter table if exists public.no_inbox_records add column if not exists gmail_message_id text;
alter table if exists public.no_inbox_records add column if not exists gmail_thread_id text;
alter table if exists public.no_inbox_records add column if not exists raw jsonb not null default '{}'::jsonb;

alter table if exists public.message_categories add column if not exists active boolean not null default true;
alter table if exists public.message_schedules add column if not exists raw jsonb not null default '{}'::jsonb;

create table if not exists public.scout_schema_versions (
  version text primary key,
  applied_at timestamptz not null default now(),
  notes text
);
insert into public.scout_schema_versions(version, applied_at, notes)
values ('10.40.0', now(), 'Full replies, signature sync, schema-health reconciliation')
on conflict (version) do update
set applied_at = excluded.applied_at,
    notes = excluded.notes;

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

-- Exact result: every row below must show READY.
with required_columns(table_name, column_name) as (values
  ('workspaces','email_signature_text'),
  ('workspaces','email_signature_html'),
  ('workspaces','email_logo_url'),
  ('gmail_accounts','signature_text'),
  ('gmail_accounts','signature_html'),
  ('gmail_accounts','signature_logo_url'),
  ('gmail_accounts','granted_scopes'),
  ('gmail_accounts','last_reply_sync_at'),
  ('reply_history','gmail_message_id'),
  ('no_inbox_records','gmail_message_id')
)
select table_name, column_name,
       case when exists (
         select 1 from information_schema.columns c
         where c.table_schema='public'
           and c.table_name=required_columns.table_name
           and c.column_name=required_columns.column_name
       ) then 'READY' else 'MISSING' end as status
from required_columns
order by table_name, column_name;
