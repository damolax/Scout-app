-- Scout v10.40.0 read-only installation verification.
with required_columns(table_name,column_name) as (values
 ('gmail_accounts','granted_scopes'),('gmail_accounts','oauth_reconnect_required'),
 ('gmail_accounts','last_reply_sync_at'),('gmail_accounts','last_reply_sync_status'),
 ('gmail_accounts','last_reply_sync_error'),('gmail_accounts','last_reply_message_id'),
 ('gmail_accounts','last_reply_history_id'),('gmail_accounts','sync_signature_to_gmail'),
 ('gmail_accounts','gmail_signature_synced_at'),('gmail_accounts','gmail_signature_sync_error'),
 ('reply_history','gmail_message_id'),('reply_history','gmail_thread_id'),
 ('no_inbox_records','gmail_message_id'),('no_inbox_records','gmail_thread_id')
), found as (
 select r.table_name,r.column_name,(c.column_name is not null) as present
 from required_columns r left join information_schema.columns c
 on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
)
select 'schema_contract' as check_name, exists(select 1 from public.scout_schema_versions where version='10.40.0') as passed, 'Expected 10.40.0' as detail
union all
select 'required_columns', bool_and(present), string_agg(case when not present then table_name||'.'||column_name end, ', ') from found
union all
select 'reply_dedup_index', to_regclass('public.reply_history_workspace_gmail_message_uidx') is not null, 'Unique Gmail message protection'
union all
select 'delivery_dedup_index', to_regclass('public.no_inbox_workspace_gmail_message_uidx') is not null, 'Unique delivery message protection'
union all
select 'followup_queue_rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_due_followups'), 'get_due_followups'
union all
select 'followup_count_rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='count_due_followups'), 'count_due_followups';
