import type { SupabaseClient } from '@supabase/supabase-js';

export const SCOUT_SCHEMA_CONTRACT_VERSION = '10.42.5';

type TableContract = {
  table: string;
  columns: string[];
};

export type SchemaState = 'good' | 'missing' | 'degraded';

export type SchemaCheck = {
  key: string;
  label: string;
  ok: boolean;
  state: SchemaState;
  detail: string;
};

export type SchemaProbe = {
  requiredFunctions?: Record<string, boolean>;
  contactableLeads?: number | null;
  contactableCountError?: string | null;
  installedVersion?: string | null;
  [key: string]: unknown;
};

export type SchemaReadiness = {
  ready: boolean;
  confirmedMissing: boolean;
  contractVersion: string;
  requiredVersion: string;
  installedVersion: string | null;
  checkedAt: string;
  checks: SchemaCheck[];
  missing: string[];
  degraded: string[];
  probe: SchemaProbe | null;
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
      'last_reply_sync_error', 'last_reply_message_id', 'last_reply_history_id',
      'health_recommended_limit', 'health_score', 'health_reliability',
      'owner_override_limit', 'owner_override_active', 'owner_override_until',
      'owner_override_locked', 'harmful_override_streak', 'recovery_step', 'last_recovery_progress_day',
      'strict_disabled_at', 'last_health_metrics', 'raw'
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
    columns: ['id', 'workspace_id', 'name', 'subject', 'message', 'template_type', 'active', 'raw']
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
    table: 'import_jobs',
    columns: ['id','workspace_id','status','total_rows','staged_rows','processed_rows','inserted_rows','duplicate_rows','invalid_rows','suppressed_rows','research_rows','last_progress_at','created_at','updated_at']
  },
  {
    table: 'import_job_rows',
    columns: ['job_id','row_no','dedupe_key','row_data','status','processed_at','created_at']
  },
  {
    table: 'lead_dedupe_registry',
    columns: ['workspace_id','dedupe_key','business_id','first_import_job_id','first_seen_at','last_seen_at']
  },
  {
    table: 'sender_health_daily',
    columns: ['id','workspace_id','gmail_account_id','active_day','attempted_count','health_score','harmful','override_active','metrics','assessed_at']
  },
  {
    table: 'sender_limit_audit',
    columns: ['id','workspace_id','gmail_account_id','action','reason','metrics','created_at']
  },
  {
    table: 'scouting_xp_state',
    columns: ['workspace_id','total_xp','baseline_xp','last_confirmed_at','updated_at']
  },
  {
    table: 'scouting_xp_events',
    columns: ['id','workspace_id','event_type','points','unique_event_key','metadata','created_at']
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

const CONFIRMED_MISSING_CODES = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

function errorCode(error: unknown) {
  return String((error as { code?: string } | null)?.code || '').toUpperCase();
}

function isConfirmedMissingError(error: unknown) {
  const code = errorCode(error);
  const text = compactError(error).toLowerCase();
  return CONFIRMED_MISSING_CODES.has(code)
    || text.includes('does not exist')
    || text.includes('could not find the function')
    || text.includes('could not find the table')
    || text.includes('schema cache') && (text.includes('not find') || text.includes('missing'));
}

function failedCheck(key: string, label: string, error: unknown): SchemaCheck {
  const missing = isConfirmedMissingError(error);
  return {
    key,
    label,
    ok: false,
    state: missing ? 'missing' : 'degraded',
    detail: compactError(error)
  };
}

function goodCheck(key: string, label: string, detail: string): SchemaCheck {
  return { key, label, ok: true, state: 'good', detail };
}

async function checkTable(client: SupabaseClient, contract: TableContract): Promise<SchemaCheck> {
  const select = contract.columns.join(',');
  try {
    const { error } = await client.from(contract.table).select(select).limit(1);
    if (error) return failedCheck(`table:${contract.table}`, `${contract.table} table`, error);
    return goodCheck(
      `table:${contract.table}`,
      `${contract.table} table`,
      `${contract.columns.length} required columns available.`
    );
  } catch (error) {
    return failedCheck(`table:${contract.table}`, `${contract.table} table`, error);
  }
}

function normalizeProbe(value: unknown): SchemaProbe | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as SchemaProbe : null;
}

export async function checkScoutSchema(
  client: SupabaseClient,
  workspaceId?: string | null
): Promise<SchemaReadiness> {
  const checks = await Promise.all(TABLE_CONTRACTS.map((contract) => checkTable(client, contract)));
  let probe: SchemaProbe | null = null;

  if (workspaceId) {
    try {
      const { data, error } = await client.rpc('scout_readiness_probe_v10425', {
        target_workspace: workspaceId
      });
      if (error) {
        checks.push(failedCheck(
          'rpc:scout_readiness_probe_v10425',
          'Lightweight readiness RPC',
          error
        ));
      } else {
        probe = normalizeProbe(data);
        checks.push(goodCheck(
          'rpc:scout_readiness_probe_v10425',
          'Lightweight readiness RPC',
          'Metadata-only schema and bounded lead-count probe is callable.'
        ));

        const requiredFunctions = probe?.requiredFunctions || {};
        for (const [name, exists] of Object.entries(requiredFunctions)) {
          checks.push(exists
            ? goodCheck(`function:${name}`, `${name} function`, 'Function exists in the current database schema.')
            : { key: `function:${name}`, label: `${name} function`, ok: false, state: 'missing', detail: 'Function is not installed.' });
        }

        if (probe?.contactableCountError) {
          checks.push({
            key: 'probe:contactable-count',
            label: 'Contactable lead count',
            ok: false,
            state: 'degraded',
            detail: String(probe.contactableCountError)
          });
        } else {
          checks.push(goodCheck(
            'probe:contactable-count',
            'Contactable lead count',
            `${Number(probe?.contactableLeads || 0).toLocaleString()} current contactable leads confirmed.`
          ));
        }
      }
    } catch (error) {
      checks.push(failedCheck(
        'rpc:scout_readiness_probe_v10425',
        'Lightweight readiness RPC',
        error
      ));
    }
  } else {
    checks.push({
      key: 'probe:workspace',
      label: 'Workspace readiness probe',
      ok: false,
      state: 'degraded',
      detail: 'Workspace ID is unavailable, so the workspace-specific readiness probe was skipped.'
    });
  }

  let installedVersion: string | null = typeof probe?.installedVersion === 'string'
    ? probe.installedVersion
    : null;

  try {
    const { data, error } = await client
      .from('scout_schema_versions')
      .select('version,applied_at,notes')
      .order('applied_at', { ascending: false })
      .limit(1);
    if (error) {
      checks.push(failedCheck('schema:version', 'Installed SQL version', error));
    } else {
      const row = Array.isArray(data) ? data[0] : null;
      installedVersion = String(row?.version || installedVersion || '') || null;
      const versionMatches = installedVersion === SCOUT_SCHEMA_CONTRACT_VERSION;
      checks.push(versionMatches
        ? goodCheck('schema:version', 'Installed SQL version', `Required and installed schema are ${SCOUT_SCHEMA_CONTRACT_VERSION}.`)
        : {
          key: 'schema:version',
          label: 'Installed SQL version',
          ok: false,
          state: 'missing',
          detail: `App requires ${SCOUT_SCHEMA_CONTRACT_VERSION}; latest installed version is ${installedVersion || 'not recorded'}.`
        });
    }
  } catch (error) {
    checks.push(failedCheck('schema:version', 'Installed SQL version', error));
  }

  const missing = checks
    .filter((check) => check.state === 'missing')
    .map((check) => `${check.label}: ${check.detail}`);
  const degraded = checks
    .filter((check) => check.state === 'degraded')
    .map((check) => `${check.label}: ${check.detail}`);
  const confirmedMissing = missing.length > 0;

  return {
    ready: !confirmedMissing,
    confirmedMissing,
    contractVersion: SCOUT_SCHEMA_CONTRACT_VERSION,
    requiredVersion: SCOUT_SCHEMA_CONTRACT_VERSION,
    installedVersion,
    checkedAt: new Date().toISOString(),
    checks,
    missing,
    degraded,
    probe
  };
}
