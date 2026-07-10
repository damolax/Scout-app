-- Scout v8.34 - email identity and signatures

alter table public.gmail_accounts add column if not exists signature_enabled boolean not null default true;
alter table public.gmail_accounts add column if not exists signature_text text;
alter table public.gmail_accounts add column if not exists signature_html text;
alter table public.gmail_accounts add column if not exists profile_picture_url text;
alter table public.gmail_accounts add column if not exists sync_signature_to_gmail boolean not null default false;
alter table public.gmail_accounts add column if not exists gmail_signature_synced_at timestamptz;
alter table public.gmail_accounts add column if not exists gmail_signature_sync_error text;

create index if not exists gmail_accounts_workspace_signature_idx
on public.gmail_accounts(workspace_id, signature_enabled);

-- Optional table for future multiple saved identities/signatures without changing the current UI.
create table if not exists public.email_signature_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Default Signature',
  signature_text text,
  signature_html text,
  profile_picture_url text,
  active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_signature_profiles_workspace_active_idx
on public.email_signature_profiles(workspace_id, active, created_at desc);

alter table public.email_signature_profiles enable row level security;

drop policy if exists email_signature_profiles_member_all on public.email_signature_profiles;
create policy email_signature_profiles_member_all
on public.email_signature_profiles
for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
