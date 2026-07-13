-- Scout v10.27: fast-load indexes + template raw fix
-- Safe to run more than once.
-- Fixes:
-- 1) templates.raw missing, which caused template save PGRST204.
-- 2) app slow-load / PGRST003 pressure by adding helpful indexes only when columns exist.

alter table if exists public.templates
add column if not exists raw jsonb not null default '{}'::jsonb;

alter table if exists public.templates
add column if not exists active boolean not null default true;

alter table if exists public.templates
add column if not exists template_type text not null default 'initial';

alter table if exists public.templates
add column if not exists category_name text;

alter table if exists public.templates
add column if not exists purpose text;

alter table if exists public.templates
add column if not exists reply_context text;

alter table if exists public.templates
add column if not exists subject_variants text[] not null default '{}'::text[];

alter table if exists public.templates
add column if not exists updated_at timestamptz not null default now();

-- Keep older rows valid for template lists/performance.
update public.templates
set active = true
where active is null;

update public.templates
set template_type = 'initial'
where template_type is null or template_type = '';

-- Create indexes only when the table and columns exist, so this SQL does not fail on older schemas.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('app_notifications_workspace_created_idx', 'app_notifications', array['workspace_id','created_at'], 'create index if not exists app_notifications_workspace_created_idx on public.app_notifications(workspace_id, created_at desc)'),
      ('app_notifications_workspace_read_created_idx', 'app_notifications', array['workspace_id','read_at','created_at'], 'create index if not exists app_notifications_workspace_read_created_idx on public.app_notifications(workspace_id, read_at, created_at desc)'),
      ('reply_history_workspace_gmail_message_idx', 'reply_history', array['workspace_id','gmail_message_id'], 'create index if not exists reply_history_workspace_gmail_message_idx on public.reply_history(workspace_id, gmail_message_id)'),
      ('reply_history_workspace_received_idx', 'reply_history', array['workspace_id','received_at'], 'create index if not exists reply_history_workspace_received_idx on public.reply_history(workspace_id, received_at desc)'),
      ('sent_messages_workspace_thread_sent_idx', 'sent_messages', array['workspace_id','gmail_thread_id','sent_at'], 'create index if not exists sent_messages_workspace_thread_sent_idx on public.sent_messages(workspace_id, gmail_thread_id, sent_at desc)'),
      ('sent_messages_workspace_to_sent_idx', 'sent_messages', array['workspace_id','to_email','sent_at'], 'create index if not exists sent_messages_workspace_to_sent_idx on public.sent_messages(workspace_id, to_email, sent_at desc)'),
      ('message_schedules_workspace_status_updated_idx', 'message_schedules', array['workspace_id','status','updated_at'], 'create index if not exists message_schedules_workspace_status_updated_idx on public.message_schedules(workspace_id, status, updated_at desc)'),
      ('email_research_jobs_workspace_status_updated_idx', 'email_research_jobs', array['workspace_id','status','updated_at'], 'create index if not exists email_research_jobs_workspace_status_updated_idx on public.email_research_jobs(workspace_id, status, updated_at desc)'),
      ('activity_logs_workspace_type_created_idx', 'activity_logs', array['workspace_id','type','created_at'], 'create index if not exists activity_logs_workspace_type_created_idx on public.activity_logs(workspace_id, type, created_at desc)'),
      ('outreach_events_workspace_type_created_idx', 'outreach_events', array['workspace_id','type','created_at'], 'create index if not exists outreach_events_workspace_type_created_idx on public.outreach_events(workspace_id, type, created_at desc)'),
      ('templates_workspace_active_created_idx', 'templates', array['workspace_id','active','created_at'], 'create index if not exists templates_workspace_active_created_idx on public.templates(workspace_id, active, created_at desc)'),
      ('templates_workspace_type_active_idx', 'templates', array['workspace_id','template_type','active'], 'create index if not exists templates_workspace_type_active_idx on public.templates(workspace_id, template_type, active)')
    ) as v(index_name, table_name, columns_needed, sql_text)
  loop
    if to_regclass('public.' || item.table_name) is not null
       and not exists (
         select 1
         from unnest(item.columns_needed) as c(column_name)
         where not exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = item.table_name
             and column_name = c.column_name
         )
       ) then
      execute item.sql_text;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
