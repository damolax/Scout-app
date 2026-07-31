-- =============================================================================
-- SCOUT v10.42.6 SENDING STABILITY FIX
-- Run this file once in the existing Scout Supabase project before deploying
-- the v10.42.6 code. It preserves all users, Gmail tokens, leads, templates,
-- replies, schedules and sending history.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Follow-up queue indexes. The old count/preview queries could scan the same
-- message history twice and hit PostgreSQL 57014 while a send was already live.
create index if not exists sent_messages_followup_due_v10426_idx
  on public.sent_messages (workspace_id, business_id, sent_at desc)
  include (subject, template_id, gmail_account_id, is_follow_up)
  where status in ('sent', 'delivered') and business_id is not null;

create index if not exists reply_history_followup_due_v10426_idx
  on public.reply_history (workspace_id, business_id, received_at desc)
  include (is_real_reply, is_auto_reply, is_delivery_failure, is_blocked)
  where business_id is not null;

create index if not exists message_schedules_global_stale_v10426_idx
  on public.message_schedules (status, updated_at)
  where finished_at is null and (stop_requested is null or stop_requested = false);

create index if not exists message_schedules_due_worker_v10426_idx
  on public.message_schedules (status, scheduled_for, workspace_id)
  where stop_requested is null or stop_requested = false;

-- Replace only the current staged signatures.
drop function if exists public.count_due_followups(uuid, text, integer, integer, uuid, text);
drop function if exists public.get_due_followups(uuid, integer, text, integer, integer, uuid, text);

create function public.get_due_followups(
  target_workspace uuid,
  limit_rows int default 100,
  followup_segment text default 'all_unanswered',
  requested_stage int default 1,
  followup_after_hours int default 72,
  target_category_id uuid default null,
  target_country text default ''
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
  followup_stage integer,
  previous_followups integer,
  next_eligible_at timestamptz,
  followup_segment text,
  reply_state text,
  last_auto_reply_at timestamptz
)
language sql
security definer
set search_path = public
as $fn$
  with access_guard as (
    select 1 as allowed
    where auth.role() = 'service_role' or public.is_workspace_member(target_workspace)
  ), message_rollup as (
    select
      sm.business_id,
      max(sm.sent_at) as last_sent_at,
      count(*) filter (where coalesce(sm.is_follow_up, false))::integer as followup_count
    from public.sent_messages sm
    cross join access_guard
    where sm.workspace_id = target_workspace
      and sm.status in ('sent', 'delivered')
      and sm.business_id is not null
    group by sm.business_id
  ), reply_flags as (
    select
      rh.business_id,
      bool_or(coalesce(rh.is_real_reply, false)) as has_real_reply,
      bool_or(coalesce(rh.is_auto_reply, false)) as has_auto_reply,
      bool_or(coalesce(rh.is_delivery_failure, false) or coalesce(rh.is_blocked, false)) as has_bad_inbox,
      max(case when coalesce(rh.is_auto_reply, false) then rh.received_at else null end) as auto_reply_at
    from public.reply_history rh
    cross join access_guard
    where rh.workspace_id = target_workspace
      and rh.business_id is not null
    group by rh.business_id
  ), due as (
    select
      b.id,
      b.name,
      b.email,
      b.website,
      mr.last_sent_at,
      mr.followup_count,
      coalesce(rf.has_auto_reply, false) as has_auto_reply,
      rf.auto_reply_at
    from public.businesses b
    join message_rollup mr on mr.business_id = b.id
    left join reply_flags rf on rf.business_id = b.id
    cross join access_guard
    where b.workspace_id = target_workspace
      and coalesce(b.email, '') <> ''
      and coalesce(b.status, '') not in ('responded', 'bad_inbox', 'bounced', 'no_inbox', 'blocked', 'invalid', 'duplicate', 'archived')
      and mr.followup_count = greatest(1, least(2, requested_stage)) - 1
      and mr.followup_count < 2
      and mr.last_sent_at <= now() - make_interval(hours => greatest(1, least(720, followup_after_hours)))
      and coalesce(rf.has_real_reply, false) = false
      and coalesce(rf.has_bad_inbox, false) = false
      and (
        followup_segment in ('all', 'all_unanswered', '')
        or (followup_segment = 'no_reply' and coalesce(rf.has_auto_reply, false) = false)
        or (followup_segment = 'auto_reply' and coalesce(rf.has_auto_reply, false) = true)
      )
      and (target_category_id is null or b.category_id = target_category_id)
      and (
        coalesce(trim(target_country), '') = ''
        or lower(coalesce(b.location, '')) like '%' || lower(trim(target_country)) || '%'
        or lower(coalesce(b.raw::text, '')) like '%' || lower(trim(target_country)) || '%'
      )
    order by mr.last_sent_at asc, b.id asc
    limit greatest(1, least(50000, limit_rows))
  )
  select
    d.id as business_id,
    coalesce(d.name, '') as business_name,
    coalesce(d.email, '') as to_email,
    coalesce(d.website, '') as website,
    d.last_sent_at,
    ls.subject as last_subject,
    ls.template_id,
    ls.gmail_account_id,
    (d.followup_count + 1)::integer as followup_stage,
    d.followup_count::integer as previous_followups,
    d.last_sent_at + make_interval(hours => greatest(1, least(720, followup_after_hours))) as next_eligible_at,
    case when d.has_auto_reply then 'auto_reply' else 'no_reply' end as followup_segment,
    case when d.has_auto_reply then 'auto_reply' else 'no_reply' end as reply_state,
    d.auto_reply_at as last_auto_reply_at
  from due d
  join lateral (
    select sm.subject, sm.template_id, sm.gmail_account_id
    from public.sent_messages sm
    where sm.workspace_id = target_workspace
      and sm.business_id = d.id
      and sm.status in ('sent', 'delivered')
    order by sm.sent_at desc nulls last
    limit 1
  ) ls on true
  order by d.last_sent_at asc, d.id asc;
$fn$;

revoke all on function public.get_due_followups(uuid, integer, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.get_due_followups(uuid, integer, text, integer, integer, uuid, text) to authenticated, service_role;

create function public.count_due_followups(
  target_workspace uuid,
  followup_segment text default 'all_unanswered',
  requested_stage int default 1,
  followup_after_hours int default 72,
  target_category_id uuid default null,
  target_country text default ''
)
returns bigint
language sql
security definer
set search_path = public
as $fn$
  with access_guard as (
    select 1 as allowed
    where auth.role() = 'service_role' or public.is_workspace_member(target_workspace)
  ), message_rollup as (
    select
      sm.business_id,
      max(sm.sent_at) as last_sent_at,
      count(*) filter (where coalesce(sm.is_follow_up, false))::integer as followup_count
    from public.sent_messages sm
    cross join access_guard
    where sm.workspace_id = target_workspace
      and sm.status in ('sent', 'delivered')
      and sm.business_id is not null
    group by sm.business_id
  ), reply_flags as (
    select
      rh.business_id,
      bool_or(coalesce(rh.is_real_reply, false)) as has_real_reply,
      bool_or(coalesce(rh.is_auto_reply, false)) as has_auto_reply,
      bool_or(coalesce(rh.is_delivery_failure, false) or coalesce(rh.is_blocked, false)) as has_bad_inbox
    from public.reply_history rh
    cross join access_guard
    where rh.workspace_id = target_workspace
      and rh.business_id is not null
    group by rh.business_id
  )
  select count(*)::bigint
  from public.businesses b
  join message_rollup mr on mr.business_id = b.id
  left join reply_flags rf on rf.business_id = b.id
  cross join access_guard
  where b.workspace_id = target_workspace
    and coalesce(b.email, '') <> ''
    and coalesce(b.status, '') not in ('responded', 'bad_inbox', 'bounced', 'no_inbox', 'blocked', 'invalid', 'duplicate', 'archived')
    and mr.followup_count = greatest(1, least(2, requested_stage)) - 1
    and mr.followup_count < 2
    and mr.last_sent_at <= now() - make_interval(hours => greatest(1, least(720, followup_after_hours)))
    and coalesce(rf.has_real_reply, false) = false
    and coalesce(rf.has_bad_inbox, false) = false
    and (
      followup_segment in ('all', 'all_unanswered', '')
      or (followup_segment = 'no_reply' and coalesce(rf.has_auto_reply, false) = false)
      or (followup_segment = 'auto_reply' and coalesce(rf.has_auto_reply, false) = true)
    )
    and (target_category_id is null or b.category_id = target_category_id)
    and (
      coalesce(trim(target_country), '') = ''
      or lower(coalesce(b.location, '')) like '%' || lower(trim(target_country)) || '%'
      or lower(coalesce(b.raw::text, '')) like '%' || lower(trim(target_country)) || '%'
    );
$fn$;

revoke all on function public.count_due_followups(uuid, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.count_due_followups(uuid, text, integer, integer, uuid, text) to authenticated, service_role;

-- The browser now only wakes the central worker. The worker HTTP request is
-- allowed to finish one safe chunk instead of being cut off after 10 seconds.
create or replace function public.configure_scout_message_worker(
  target_app_url text,
  target_worker_secret text,
  target_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault, cron, net
as $$
declare
  clean_url text;
  safe_seconds integer;
  url_secret_id uuid;
  worker_secret_id uuid;
  scheduled_job_id bigint;
  worker_command text;
begin
  clean_url := regexp_replace(trim(coalesce(target_app_url, '')), '/+$', '');
  safe_seconds := greatest(10, least(60, coalesce(target_seconds, 30)));

  if clean_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Scout worker app URL must be a valid HTTPS URL.';
  end if;
  if length(trim(coalesce(target_worker_secret, ''))) < 24 then
    raise exception 'Scout worker secret must contain at least 24 characters.';
  end if;

  select id into url_secret_id
  from vault.secrets
  where name = 'scout_message_worker_app_url'
  order by created_at desc
  limit 1;

  if url_secret_id is null then
    perform vault.create_secret(
      clean_url,
      'scout_message_worker_app_url',
      'Scout production app URL used by the central message worker.'
    );
  else
    perform vault.update_secret(
      url_secret_id,
      clean_url,
      'scout_message_worker_app_url',
      'Scout production app URL used by the central message worker.'
    );
  end if;

  select id into worker_secret_id
  from vault.secrets
  where name = 'scout_message_worker_secret'
  order by created_at desc
  limit 1;

  if worker_secret_id is null then
    perform vault.create_secret(
      trim(target_worker_secret),
      'scout_message_worker_secret',
      'Private authorization secret for the Scout central message worker.'
    );
  else
    perform vault.update_secret(
      worker_secret_id,
      trim(target_worker_secret),
      'scout_message_worker_secret',
      'Private authorization secret for the Scout central message worker.'
    );
  end if;

  worker_command := $worker$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_app_url' order by created_at desc limit 1)
        || '/api/message/run-schedules',
      body := jsonb_build_object(
        'limit', 1,
        'token', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_secret' order by created_at desc limit 1)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-schedule-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scout_message_worker_secret' order by created_at desc limit 1)
      ),
      timeout_milliseconds := 55000
    ) as request_id;
  $worker$;

  for scheduled_job_id in
    select jobid from cron.job where jobname = 'scout-message-worker-every-15-seconds'
  loop
    perform cron.unschedule(scheduled_job_id);
  end loop;

  select cron.schedule(
    'scout-message-worker-every-15-seconds',
    safe_seconds::text || ' seconds',
    worker_command
  ) into scheduled_job_id;

  return jsonb_build_object(
    'ready', true,
    'job_id', scheduled_job_id,
    'job_name', 'scout-message-worker-every-15-seconds',
    'schedule', safe_seconds::text || ' seconds',
    'app_url', clean_url
  );
end;
$$;


revoke all on function public.configure_scout_message_worker(text, text, integer) from public, anon, authenticated;
grant execute on function public.configure_scout_message_worker(text, text, integer) to service_role;

-- Rebuild the existing worker from the already-saved Vault values. This does
-- not reveal or replace the secret. If Vault has not been configured yet,
-- opening Scout Settings or starting a job will configure it after deployment.
do $do$
declare
  saved_url text;
  saved_secret text;
begin
  select decrypted_secret into saved_url
  from vault.decrypted_secrets
  where name = 'scout_message_worker_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into saved_secret
  from vault.decrypted_secrets
  where name = 'scout_message_worker_secret'
  order by created_at desc
  limit 1;

  if coalesce(saved_url, '') <> '' and length(coalesce(saved_secret, '')) >= 24 then
    perform public.configure_scout_message_worker(saved_url, saved_secret, 30);
  end if;
exception when others then
  raise notice 'Worker will be configured by Scout after deployment: %', sqlerrm;
end;
$do$;

insert into public.scout_schema_versions(version, applied_at, notes)
values ('10.42.6', clock_timestamp(), 'Non-blocking scheduled sending, worker collision protection, resilient follow-up preview/count, and follow-up queue indexes.')
on conflict (version) do update
set applied_at = clock_timestamp(),
    notes = excluded.notes;

notify pgrst, 'reload schema';

select
  'READY'::text as scout_v10426_status,
  to_regclass('public.sent_messages_followup_due_v10426_idx') is not null as sent_followup_index_ready,
  to_regclass('public.reply_history_followup_due_v10426_idx') is not null as reply_followup_index_ready,
  to_regclass('public.message_schedules_global_stale_v10426_idx') is not null as stale_worker_index_ready,
  to_regprocedure('public.get_due_followups(uuid,integer,text,integer,integer,uuid,text)') is not null as due_followups_ready,
  to_regprocedure('public.count_due_followups(uuid,text,integer,integer,uuid,text)') is not null as count_due_followups_ready,
  exists(select 1 from public.scout_schema_versions where version = '10.42.6') as version_recorded,
  coalesce((public.scout_message_worker_status()->>'ready')::boolean, false) as worker_ready,
  public.scout_message_worker_status()->>'schedule' as worker_schedule;
