-- Scout v8.46 optional storage/schema helper
-- The app can create this bucket automatically through the service-role API.
-- Run this if logo upload says the email-assets bucket does not exist or cannot be made public.

alter table if exists public.workspaces add column if not exists email_logo_url text;
alter table if exists public.workspaces add column if not exists email_signature_text text;
alter table if exists public.workspaces add column if not exists email_signature_html text;

alter table if exists public.gmail_accounts add column if not exists signature_logo_url text;
alter table if exists public.gmail_accounts add column if not exists signature_enabled boolean not null default true;
alter table if exists public.gmail_accounts add column if not exists signature_text text;
alter table if exists public.gmail_accounts add column if not exists signature_html text;
alter table if exists public.gmail_accounts add column if not exists sync_signature_to_gmail boolean not null default false;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_synced_at timestamptz;
alter table if exists public.gmail_accounts add column if not exists gmail_signature_sync_error text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 2097152, array['image/png','image/jpeg','image/jpg','image/webp','image/gif'])
on conflict (id) do update
set public = true,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/png','image/jpeg','image/jpg','image/webp','image/gif'];

notify pgrst, 'reload schema';
