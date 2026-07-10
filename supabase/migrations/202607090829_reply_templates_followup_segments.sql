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

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  subject text not null default '',
  message text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.templates add column if not exists subject_variants text[] not null default '{}';
alter table public.templates add column if not exists active boolean not null default true;
alter table public.templates add column if not exists category_id uuid;
alter table public.templates add column if not exists category_name text;
alter table public.templates add column if not exists template_type text not null default 'initial';
alter table public.templates add column if not exists purpose text;
alter table public.templates add column if not exists reply_context text;
alter table public.templates add column if not exists tags text[] not null default '{}';
alter table public.templates add column if not exists updated_at timestamptz not null default now();

update public.templates
set template_type = 'initial'
where template_type is null or template_type = '';

alter table public.templates drop constraint if exists templates_template_type_check;
alter table public.templates add constraint templates_template_type_check
check (template_type in ('initial', 'follow_up', 'reply'));

create index if not exists templates_workspace_type_idx
on public.templates(workspace_id, template_type, active, created_at desc);

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

alter table public.message_schedules add column if not exists followup_segment text;
alter table public.message_schedules add column if not exists started_at timestamptz;
alter table public.message_schedules add column if not exists finished_at timestamptz;
alter table public.message_schedules add column if not exists batch_id text;
alter table public.message_schedules add column if not exists processed_count int not null default 0;
alter table public.message_schedules add column if not exists sent_count int not null default 0;
alter table public.message_schedules add column if not exists failed_count int not null default 0;
alter table public.message_schedules add column if not exists skipped_count int not null default 0;
alter table public.message_schedules add column if not exists last_error text;

alter table public.message_schedules drop constraint if exists message_schedules_followup_segment_check;
alter table public.message_schedules add constraint message_schedules_followup_segment_check
check (followup_segment is null or followup_segment in ('all_unanswered', 'no_reply', 'auto_reply'));

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

alter table public.sent_messages add column if not exists template_id uuid;
alter table public.sent_messages add column if not exists is_follow_up boolean not null default false;
alter table public.sent_messages add column if not exists followup_due_at timestamptz;
alter table public.sent_messages add column if not exists last_reply_at timestamptz;
alter table public.sent_messages add column if not exists delivery_status text;
alter table public.sent_messages add column if not exists error_code text;
alter table public.sent_messages add column if not exists raw jsonb not null default '{}'::jsonb;

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
  matched_status text,
  received_at timestamptz not null default now(),
  gmail_message_id text,
  gmail_thread_id text,
  raw jsonb not null default '{}'::jsonb
);

alter table public.reply_history add column if not exists reply_bucket text;
alter table public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table public.reply_history add column if not exists is_delivery_failure boolean not null default false;
alter table public.reply_history add column if not exists is_blocked boolean not null default false;
alter table public.reply_history add column if not exists is_limit_notice boolean not null default false;
alter table public.reply_history add column if not exists is_temporary boolean not null default false;
alter table public.reply_history add column if not exists matched_status text;
alter table public.reply_history add column if not exists received_at timestamptz not null default now();
alter table public.reply_history add column if not exists raw jsonb not null default '{}'::jsonb;

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

create index if not exists reply_history_workspace_business_bucket_idx
on public.reply_history(workspace_id, business_id, reply_bucket, received_at desc);

create index if not exists sent_messages_workspace_business_sent_idx
on public.sent_messages(workspace_id, business_id, sent_at desc);

create index if not exists no_inbox_records_workspace_business_idx
on public.no_inbox_records(workspace_id, business_id, created_at desc);

create or replace function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100,
  followup_segment text default 'all_unanswered'
)
returns table(
  business_id uuid,
  business_name text,
  to_email text,
  last_sent_at timestamptz,
  last_subject text,
  template_id uuid,
  gmail_account_id uuid,
  segment text,
  reply_state text,
  last_auto_reply_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace) then
    raise exception 'User is not approved for this workspace';
  end if;

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
      and s.sent_at <= now() - interval '72 hours'
      and s.business_id is not null
      and coalesce(s.delivery_status, '') <> 'manual_reply_sent'
    order by s.business_id, s.sent_at desc
  ), classified as (
    select
      b.id as business_id,
      b.name as business_name,
      coalesce(nullif(l.to_email, ''), b.email) as to_email,
      l.sent_at as last_sent_at,
      l.subject as last_subject,
      l.template_id,
      l.gmail_account_id,
      b.reply_state,
      b.last_auto_reply_at,
      exists (
        select 1 from public.reply_history r
        where r.workspace_id = target_workspace
          and r.business_id = b.id
          and (coalesce(r.is_real_reply, false) = true or r.reply_bucket = 'real_reply')
          and r.received_at >= l.sent_at
      ) as has_real_reply,
      exists (
        select 1 from public.reply_history r
        where r.workspace_id = target_workspace
          and r.business_id = b.id
          and (coalesce(r.is_auto_reply, false) = true or r.reply_bucket = 'auto_reply')
          and r.received_at >= l.sent_at
      ) as has_auto_reply,
      exists (
        select 1 from public.reply_history r
        where r.workspace_id = target_workspace
          and r.business_id = b.id
          and (coalesce(r.is_real_reply, false) = true or coalesce(r.is_auto_reply, false) = true or r.reply_bucket in ('real_reply', 'auto_reply'))
          and r.received_at >= l.sent_at
      ) as has_any_reply,
      exists (
        select 1 from public.no_inbox_records n
        where n.workspace_id = target_workspace
          and (n.business_id = b.id or lower(coalesce(n.email, n.to_email, '')) = lower(coalesce(l.to_email, b.email, '')))
          and n.created_at >= l.sent_at
      ) as has_delivery_failure
    from latest_sent l
    join public.businesses b on b.id = l.business_id and b.workspace_id = target_workspace
    where b.status in ('contacted', 'ready', 'found', 'review')
      and coalesce(nullif(l.to_email, ''), b.email, '') <> ''
  )
  select
    c.business_id,
    c.business_name,
    c.to_email,
    c.last_sent_at,
    c.last_subject,
    c.template_id,
    c.gmail_account_id,
    case when c.has_auto_reply then 'auto_reply' else 'no_reply' end as segment,
    c.reply_state,
    c.last_auto_reply_at
  from classified c
  where c.has_real_reply = false
    and c.has_delivery_failure = false
    and (
      coalesce(followup_segment, 'all_unanswered') = 'all_unanswered'
      or (followup_segment = 'no_reply' and c.has_any_reply = false)
      or (followup_segment = 'auto_reply' and c.has_auto_reply = true)
    )
  order by c.last_sent_at asc
  limit greatest(1, least(coalesce(limit_rows, 100), 5000));
end;
$$;

grant execute on function public.get_due_followups(uuid, int, text) to authenticated;

alter table public.templates enable row level security;
alter table public.message_schedules enable row level security;
alter table public.sent_messages enable row level security;
alter table public.reply_history enable row level security;
alter table public.no_inbox_records enable row level security;

drop policy if exists templates_member_all on public.templates;
create policy templates_member_all on public.templates for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists message_schedules_member_all on public.message_schedules;
create policy message_schedules_member_all on public.message_schedules for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists sent_messages_member_all on public.sent_messages;
create policy sent_messages_member_all on public.sent_messages for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists reply_history_member_all on public.reply_history;
create policy reply_history_member_all on public.reply_history for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists no_inbox_records_member_all on public.no_inbox_records;
create policy no_inbox_records_member_all on public.no_inbox_records for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

insert into public.templates (workspace_id, name, category_name, template_type, subject, subject_variants, message, purpose, active)
values
('00000000-0000-4000-8000-000000000001', 'Default follow-up: no reply', 'General follow-ups', 'follow_up', 'Re: quick idea for {business}', array['Following up on {business}'], 'Hi {name},\n\nJust following up on my earlier message about {business}.\n\nWould it be useful if I sent the 2-3 practical improvements I noticed?\n\nBest regards,\nOlalekan', 'Use for businesses with inbox but no reply after the first message.', true),
('00000000-0000-4000-8000-000000000001', 'Default reply: thanks for responding', 'Reply templates', 'reply', 'Re: {last_subject}', array['Re: {business}'], 'Hi {name},\n\nThanks for getting back to me.\n\nThat makes sense. Based on what you said, I can send a short practical breakdown for {business}.\n\nBest regards,\nOlalekan', 'Use only from a business conversation after a prospect replies.', true)
on conflict do nothing;

select pg_notify('pgrst', 'reload schema');
