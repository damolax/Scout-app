-- Scout v10.5: sender limit pause + template attachments

alter table if exists public.gmail_accounts
add column if not exists is_paused boolean not null default false;

alter table if exists public.gmail_accounts
add column if not exists paused_reason text;

alter table if exists public.gmail_accounts
add column if not exists paused_until timestamptz;

alter table if exists public.gmail_accounts
add column if not exists last_error text;

alter table if exists public.templates
add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table if exists public.templates
add column if not exists raw jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  true,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];

notify pgrst, 'reload schema';
