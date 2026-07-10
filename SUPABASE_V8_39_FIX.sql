-- Scout v8.39: simple targeting + follow-up RPC repair
-- Run this once in Supabase SQL Editor after deploying v8.39.

create table if not exists public.message_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

alter table if exists public.workspaces add column if not exists app_url text;
alter table if exists public.workspaces add column if not exists render_backend_url text;
alter table if exists public.workspaces add column if not exists default_audience_category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.workspaces add column if not exists default_audience_category_name text;
alter table if exists public.workspaces add column if not exists dork_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists extension_settings jsonb not null default '{}'::jsonb;
alter table if exists public.workspaces add column if not exists updated_at timestamptz not null default now();

alter table if exists public.businesses add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.businesses add column if not exists category_name text;
alter table if exists public.import_batches add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.import_batches add column if not exists category_name text;
alter table if exists public.import_batches add column if not exists source_mode text;
alter table if exists public.scout_history add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.scout_history add column if not exists category_name text;
alter table if exists public.daily_scouting_submissions add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.daily_scouting_submissions add column if not exists category_name text;
alter table if exists public.templates add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.templates add column if not exists category_name text;
alter table if exists public.message_schedules add column if not exists audience_category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.message_schedules add column if not exists audience_category_name text;
alter table if exists public.message_schedules add column if not exists category_id uuid references public.message_categories(id) on delete set null;
alter table if exists public.message_schedules add column if not exists followup_segment text;
alter table if exists public.message_schedules add column if not exists target_count int not null default 0;
alter table if exists public.message_schedules add column if not exists processed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists sent_count int not null default 0;
alter table if exists public.message_schedules add column if not exists failed_count int not null default 0;
alter table if exists public.message_schedules add column if not exists skipped_count int not null default 0;
alter table if exists public.message_schedules add column if not exists updated_at timestamptz not null default now();
alter table if exists public.no_inbox_records add column if not exists to_email text;
alter table if exists public.no_inbox_records add column if not exists business_id uuid;
alter table if exists public.no_inbox_records add column if not exists email text;
alter table if exists public.no_inbox_records add column if not exists created_at timestamptz not null default now();
alter table if exists public.reply_history add column if not exists is_real_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists is_auto_reply boolean not null default false;
alter table if exists public.reply_history add column if not exists reply_bucket text;
alter table if exists public.reply_history add column if not exists received_at timestamptz not null default now();

create index if not exists message_categories_workspace_name_idx on public.message_categories(workspace_id, name);
create index if not exists businesses_workspace_category_id_idx on public.businesses(workspace_id, category_id, status, updated_at desc);
create index if not exists templates_workspace_category_id_idx on public.templates(workspace_id, category_id, active, created_at desc);
create index if not exists message_schedules_workspace_audience_category_idx on public.message_schedules(workspace_id, audience_category_id, status, scheduled_for);

insert into public.message_categories (workspace_id, name, description, active)
select w.id, category_name, category_description, true
from public.workspaces w
cross join (values
  ('Airtable', 'Audience and templates for Airtable service outreach.'),
  ('Shopify', 'Audience and templates for Shopify / ecommerce outreach.')
) as seed(category_name, category_description)
on conflict (workspace_id, name) do update set active = true, description = excluded.description, updated_at = now();

-- Keep old text categories connected to the new category records where names match.
update public.businesses b
set category_id = c.id,
    category_name = c.name
from public.message_categories c
where b.workspace_id = c.workspace_id
  and b.category_id is null
  and lower(coalesce(b.category_name, b.category, '')) = lower(c.name);

update public.templates t
set category_id = c.id,
    category_name = c.name
from public.message_categories c
where t.workspace_id = c.workspace_id
  and t.category_id is null
  and lower(coalesce(t.category_name, '')) = lower(c.name);

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
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Not authenticated';
    end if;
    if not public.is_workspace_member(target_workspace) then
      raise exception 'User is not approved for this workspace';
    end if;
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
grant execute on function public.get_due_followups(uuid, int, text) to service_role;

select pg_notify('pgrst', 'reload schema');
