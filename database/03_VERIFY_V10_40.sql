-- Scout v10.40.0 read-only runtime-contract verification.
with required_columns(table_name,column_name) as (values
 ('scout_schema_versions','version'),('scout_schema_versions','applied_at'),('scout_schema_versions','notes'),
 ('workspaces','id'),('workspaces','name'),('workspaces','api_key'),('workspaces','app_url'),('workspaces','timezone'),
 ('workspaces','default_audience_category_id'),('workspaces','default_audience_category_name'),('workspaces','dork_settings'),
 ('workspaces','extension_settings'),('workspaces','email_signature_text'),('workspaces','email_signature_html'),
 ('workspaces','email_logo_url'),('workspaces','updated_at'),
 ('workspace_members','workspace_id'),('workspace_members','user_id'),('workspace_members','approved'),('workspace_members','role'),('workspace_members','created_at'),
 ('gmail_accounts','id'),('gmail_accounts','workspace_id'),('gmail_accounts','email'),('gmail_accounts','status'),
 ('gmail_accounts','signature_enabled'),('gmail_accounts','signature_text'),('gmail_accounts','signature_html'),
 ('gmail_accounts','signature_logo_url'),('gmail_accounts','sync_signature_to_gmail'),('gmail_accounts','gmail_signature_synced_at'),
 ('gmail_accounts','gmail_signature_sync_error'),('gmail_accounts','granted_scopes'),('gmail_accounts','oauth_reconnect_required'),
 ('gmail_accounts','last_reply_sync_at'),('gmail_accounts','last_reply_sync_status'),('gmail_accounts','last_reply_sync_error'),
 ('gmail_accounts','last_reply_message_id'),('gmail_accounts','last_reply_history_id'),('gmail_accounts','raw'),
 ('businesses','id'),('businesses','workspace_id'),('businesses','name'),('businesses','email'),('businesses','website'),
 ('businesses','location'),('businesses','status'),('businesses','raw'),('businesses','reply_state'),
 ('businesses','last_reply_classification'),('businesses','last_inbound_at'),('businesses','last_auto_reply_at'),
 ('businesses','last_real_reply_at'),('businesses','email_verification_status'),('businesses','email_verification_level'),
 ('businesses','email_verified_at'),('businesses','email_verification_reason'),('businesses','email_role_label'),('businesses','email_mx_hosts'),
 ('templates','id'),('templates','workspace_id'),('templates','name'),('templates','subject'),('templates','message'),
 ('templates','template_type'),('templates','active'),('templates','raw'),
 ('sent_messages','id'),('sent_messages','workspace_id'),('sent_messages','business_id'),('sent_messages','template_id'),
 ('sent_messages','gmail_account_id'),('sent_messages','from_email'),('sent_messages','to_email'),('sent_messages','subject'),
 ('sent_messages','status'),('sent_messages','delivery_status'),('sent_messages','sent_at'),('sent_messages','gmail_message_id'),
 ('sent_messages','gmail_thread_id'),('sent_messages','is_follow_up'),('sent_messages','follow_up_stage'),('sent_messages','raw'),
 ('reply_history','id'),('reply_history','workspace_id'),('reply_history','business_id'),('reply_history','sent_message_id'),
 ('reply_history','template_id'),('reply_history','gmail_account_id'),('reply_history','from_email'),('reply_history','to_email'),
 ('reply_history','subject'),('reply_history','snippet'),('reply_history','body'),('reply_history','classification'),
 ('reply_history','reply_bucket'),('reply_history','is_real_reply'),('reply_history','is_auto_reply'),
 ('reply_history','is_delivery_failure'),('reply_history','is_no_inbox'),('reply_history','is_blocked'),
 ('reply_history','is_limit_notice'),('reply_history','is_temporary'),('reply_history','received_at'),
 ('reply_history','gmail_message_id'),('reply_history','gmail_thread_id'),('reply_history','raw'),
 ('no_inbox_records','id'),('no_inbox_records','workspace_id'),('no_inbox_records','business_id'),('no_inbox_records','email'),
 ('no_inbox_records','status'),('no_inbox_records','bounce_type'),('no_inbox_records','created_at'),('no_inbox_records','raw'),
 ('message_categories','id'),('message_categories','workspace_id'),('message_categories','name'),('message_categories','active'),
 ('message_schedules','id'),('message_schedules','workspace_id'),('message_schedules','type'),('message_schedules','status'),
 ('message_schedules','scheduled_for'),('message_schedules','target_count'),('message_schedules','processed_count'),
 ('message_schedules','sent_count'),('message_schedules','failed_count'),('message_schedules','stop_requested'),('message_schedules','raw'),
 ('email_research_jobs','id'),('email_research_jobs','workspace_id'),('email_research_jobs','status'),('email_research_jobs','created_at'),
 ('activity_logs','id'),('activity_logs','workspace_id'),('activity_logs','type'),('activity_logs','message'),
 ('activity_logs','raw'),('activity_logs','created_by'),('activity_logs','created_at'),
 ('sender_send_reservations','id'),('sender_send_reservations','workspace_id'),('sender_send_reservations','gmail_account_id'),
 ('sender_send_reservations','effective_daily_limit'),('sender_send_reservations','used_before'),('sender_send_reservations','reason'),
 ('sender_send_reservations','expires_at'),('sender_send_reservations','dispatch_at'),('sender_send_reservations','reserved_at'),
 ('sender_send_reservations','finalized_at'),('sender_send_reservations','released_at'),('sender_send_reservations','raw')
), missing as (
 select r.table_name,r.column_name
 from required_columns r
 left join information_schema.columns c
 on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
 where c.column_name is null
)
select 'schema_contract' as check_name,
       exists(select 1 from public.scout_schema_versions where version='10.40.0') as passed,
       'Expected 10.40.0' as detail
union all
select 'runtime_required_columns',
       not exists(select 1 from missing),
       coalesce((select string_agg(table_name||'.'||column_name, ', ' order by table_name,column_name) from missing),'All runtime columns are present')
union all
select 'reply_dedup_index', to_regclass('public.reply_history_workspace_gmail_message_uidx') is not null, 'Unique Gmail reply-message protection'
union all
select 'delivery_dedup_index', to_regclass('public.no_inbox_workspace_gmail_message_uidx') is not null, 'Unique Gmail delivery-message protection'
union all
select 'followup_queue_rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_due_followups'), 'get_due_followups'
union all
select 'followup_count_rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='count_due_followups'), 'count_due_followups'
union all
select 'message_worker_rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='scout_message_worker_status'), 'scout_message_worker_status';
