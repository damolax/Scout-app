import type { SupabaseClient } from '@supabase/supabase-js';

export const SCOUT_SCHEMA_CONTRACT_VERSION = '10.40.0';

type TableContract = {
  table: string;
  columns: string[];
};

export type SchemaCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type SchemaReadiness = {
  ready: boolean;
  contractVersion: string;
  checkedAt: string;
  checks: SchemaCheck[];
  missing: string[];
};

const TABLE_CONTRACTS: TableContract[] = [
  {
    table: 'scout_schema_versions',
    columns: ['version', 'applied_at', 'notes']
  },
  {
    table: 'workspaces',
    columns: [
      'id', 'name', 'api_key', 'app_url', 'timezone',
      'default_audience_category_id', 'default_audience_category_name',
      'dork_settings', 'extension_settings', 'email_signature_text', 'email_signature_html',
      'email_logo_url', 'updated_at'
    ]
  },
  {
    table: 'workspace_members',
    columns: ['workspace_id', 'user_id', 'approved', 'role', 'created_at']
  },
  {
    table: 'gmail_accounts',
    columns: [
      'id', 'workspace_id', 'email', 'status', 'access_token', 'refresh_token',
      'daily_limit', 'default_run_limit', 'deployment_cap', 'deployment_run_cap',
      'health_stage', 'health_cap', 'health_reason', 'is_paused', 'paused_until',
      'paused_reason', 'pause_kind', 'safety_override_active', 'safety_override_warning',
      'pause_issue_count', 'pause_issue_window_ends_at', 'hard_restriction_active',
      'hard_restricted_until', 'hard_restriction_reason', 'connection_status',
      'connection_verified_at', 'connection_error', 'signature_enabled',
      'signature_text', 'signature_html', 'signature_logo_url', 'sync_signature_to_gmail',
      'gmail_signature_synced_at', 'gmail_signature_sync_error', 'granted_scopes',
      'oauth_reconnect_required', 'last_reply_sync_at', 'last_reply_sync_status',
      'last_reply_sync_error', 'last_reply_message_id', 'last_reply_history_id', 'raw'
    ]
  },
  {
    table: 'businesses',
    columns: [
      'id', 'workspace_id', 'name', 'email', 'website', 'location', 'status',
      'category_id', 'raw', 'reply_state', 'last_reply_classification',
      'last_inbound_at', 'last_auto_reply_at', 'last_real_reply_at',
      'email_verification_status', 'email_verification_level', 'email_verified_at',
      'email_verification_reason', 'email_role_label', 'email_mx_hosts'
    ]
  },
  {
    table: 'templates',
    columns: ['id', 'workspace_id', 'name', 'subject', 'body', 'template_type', 'active', 'raw']
  },
  {
    table: 'sent_messages',
    columns: [
      'id', 'workspace_id', 'business_id', 'template_id', 'gmail_account_id',
      'from_email', 'to_email', 'subject', 'status', 'delivery_status', 'sent_at',
      'gmail_message_id', 'gmail_thread_id', 'is_follow_up', 'follow_up_stage', 'raw'
    ]
  },
  {
    table: 'reply_history',
    columns: [
      'id', 'workspace_id', 'business_id', 'sent_message_id', 'template_id',
      'gmail_account_id', 'from_email', 'to_email', 'subject', 'snippet', 'body',
      'classification', 'reply_bucket', 'is_real_reply', 'is_auto_reply',
      'is_delivery_failure', 'is_no_inbox', 'is_blocked', 'is_limit_notice',
      'is_temporary', 'received_at', 'gmail_message_id', 'gmail_thread_id', 'raw'
    ]
  },
  {
    table: 'no_inbox_records',
    columns: ['id', 'workspace_id', 'business_id', 'email', 'status', 'bounce_type', 'created_at', 'raw']
  },
  {
    table: 'message_categories',
    columns: ['id', 'workspace_id', 'name', 'active']
  },
  {
    table: 'message_schedules',
    columns: [
      'id', 'workspace_id', 'type', 'status', 'scheduled_for', 'target_count',
      'processed_count', 'sent_count', 'failed_count', 'stop_requested', 'raw'
    ]
  },
  {
    table: 'email_research_jobs',
    columns: ['id', 'workspace_id', 'status', 'created_at']
  },
  {
    table: 'activity_logs',
    columns: ['id', 'workspace_id', 'type', 'message', 'raw', 'created_by', 'created_at']
  },
  {
    table: 'sender_send_reservations',
    columns: [
      'id', 'workspace_id', 'gmail_account_id', 'effective_daily_limit',
      'used_before', 'reason', 'expires_at', 'dispatch_at', 'reserved_at',
      'finalized_at', 'released_at', 'raw'
    ]
  }
];

function compactError(error: unknown) {
  const value = error as { message?: string; details?: string; hint?: string; code?: string } | null;
  return [value?.message, value?.details, value?.hint, value?.code ? `Code ${value.code}` : '']
    .filter(Boolean)
    .join(' | ') || String(error || 'Unknown database error');
}

async function checkTable(client: SupabaseClient, contract: TableContract): Promise<SchemaCheck> {
  const select = contract.columns.join(',');
  const { error } = await client.from(contract.table).select(select).limit(1);
  if (error) {
    return {
      key: `table:${contract.table}`,
      label: `${contract.table} table`,
      ok: false,
      detail: compactError(error)
    };
  }
  return {
    key: `table:${contract.table}`,
    label: `${contract.table} table`,
    ok: true,
    detail: `${contract.columns.length} required columns available.`
  };
}

async function checkRpc(
  client: SupabaseClient,
  key: string,
  label: string,
  name: string,
  args?: Record<string, unknown>
): Promise<SchemaCheck> {
  const { error } = await client.rpc(name, args || {});
  if (error) {
    return { key, label, ok: false, detail: compactError(error) };
  }
  return { key, label, ok: true, detail: `${name} is callable.` };
}

export async function checkScoutSchema(
  client: SupabaseClient,
  workspaceId?: string | null
): Promise<SchemaReadiness> {
  const checks: SchemaCheck[] = await Promise.all(
    TABLE_CONTRACTS.map((contract) => checkTable(client, contract))
  );

  checks.push(await checkRpc(
    client,
    'rpc:scout_message_worker_status',
    'Message worker RPC',
    'scout_message_worker_status'
  ));

  if (workspaceId) {
    checks.push(await checkRpc(
      client,
      'rpc:get_due_followups',
      'Follow-up queue RPC',
      'get_due_followups',
      {
        target_workspace: workspaceId,
        limit_rows: 1,
        followup_segment: 'all_unanswered',
        requested_stage: 1,
        followup_after_hours: 72,
        target_category_id: null,
        target_country: ''
      }
    ));
    checks.push(await checkRpc(
      client,
      'rpc:count_due_followups',
      'Follow-up count RPC',
      'count_due_followups',
      {
        target_workspace: workspaceId,
        followup_segment: 'all_unanswered',
        requested_stage: 1,
        followup_after_hours: 72,
        target_category_id: null,
        target_country: ''
      }
    ));
  } else {
    checks.push({
      key: 'rpc:followups',
      label: 'Follow-up RPCs',
      ok: false,
      detail: 'Workspace ID unavailable, so follow-up RPCs could not be checked.'
    });
  }

  const { data: versionRow, error: versionError } = await client
    .from('scout_schema_versions')
    .select('version,applied_at,notes')
    .eq('version', SCOUT_SCHEMA_CONTRACT_VERSION)
    .maybeSingle();
  checks.push({
    key: 'schema:version',
    label: 'Deployed SQL version',
    ok: !versionError && Boolean(versionRow?.version),
    detail: versionError
      ? compactError(versionError)
      : versionRow?.version
        ? `SQL contract ${versionRow.version} was recorded at ${versionRow.applied_at || 'an unknown time'}.`
        : `SQL contract ${SCOUT_SCHEMA_CONTRACT_VERSION} has not been recorded. Run the bundled Supabase SQL.`
  });

  const missing = checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.detail}`);
  return {
    ready: missing.length === 0,
    contractVersion: SCOUT_SCHEMA_CONTRACT_VERSION,
    checkedAt: new Date().toISOString(),
    checks,
    missing
  };
}
