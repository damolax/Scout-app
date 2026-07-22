'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { GmailAccount, MessageCategory, Workspace } from '@/lib/types';

const VERIFICATION_SEND_ONLY = false;

type SenderDraft = {
  daily_limit: string;
  default_run_limit: string;
  account_type: string;
};

type IdentityDraft = {
  signature_enabled: boolean;
  signature_text: string;
  signature_html: string;
  signature_logo_url: string;
};

type HealthRow = {
  name: string;
  status: 'Good' | 'Warning' | 'Fix needed';
  detail: string;
};

type SchemaPayload = {
  success?: boolean;
  ready?: boolean;
  contractVersion?: string;
  checkedAt?: string;
  checks?: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  missing?: string[];
  error?: string;
};

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error?: string };
    return [value.message || value.error, value.code ? `Code: ${value.code}` : '', value.details, value.hint]
      .filter(Boolean)
      .join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function readableDate(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function humanStage(value: unknown) {
  return String(value || 'assessment')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasActiveHardRestriction(account: GmailAccount) {
  if (!account.hard_restriction_active) return false;
  if (!account.hard_restricted_until) return true;
  return new Date(account.hard_restricted_until).getTime() > Date.now();
}

function hasActiveSafetyOverride(account: GmailAccount) {
  return Boolean(account.safety_override_active);
}

function isPaused(account: GmailAccount) {
  if (hasActiveHardRestriction(account)) return true;
  if (hasActiveSafetyOverride(account)) return false;
  if (account.is_paused === true) return true;
  if (['paused', 'limit_hit', 'blocked'].includes(String(account.status || '').toLowerCase())) return true;
  if (!account.paused_until) return false;
  return new Date(account.paused_until).getTime() > Date.now();
}

function isAutomaticSafetyPause(account: GmailAccount) {
  return Boolean(account.pause_kind && String(account.pause_kind) !== 'manual');
}

function senderSystemDailyMax(account: GmailAccount) {
  const deployment = Math.max(1, Number(account.deployment_cap || 250));
  const health = Math.max(0, Number(account.health_cap ?? deployment));
  return Math.max(0, Math.floor(Math.min(deployment, health)));
}

function senderSystemRunMax(account: GmailAccount) {
  const systemDaily = senderSystemDailyMax(account);
  const deploymentRun = Math.max(1, Number(account.deployment_run_cap || Math.min(Number(account.deployment_cap || 250), 50)));
  return Math.max(0, Math.floor(Math.min(systemDaily, deploymentRun)));
}

function senderDraft(account: GmailAccount): SenderDraft {
  const dailyMaximum = senderSystemDailyMax(account) || Number(account.deployment_cap || 250);
  const runMaximum = senderSystemRunMax(account) || Number(account.deployment_run_cap || 50);
  return {
    daily_limit: String(Math.max(1, Math.min(Number(account.daily_limit || dailyMaximum), dailyMaximum))),
    default_run_limit: String(Math.max(1, Math.min(Number(account.default_run_limit || runMaximum), runMaximum))),
    account_type: String(account.account_type || 'gmail')
  };
}

function toneClass(status: HealthRow['status']) {
  if (status === 'Good') return 'connected';
  if (status === 'Warning') return 'paused';
  return 'error';
}

export default function SettingsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SenderDraft>>({});
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [appUrl, setAppUrl] = useState(workspace.app_url || '');
  const [defaultAudienceCategoryId, setDefaultAudienceCategoryId] = useState(workspace.default_audience_category_id || '');
  const [defaultAudienceCategoryName, setDefaultAudienceCategoryName] = useState(workspace.default_audience_category_name || '');
  const [identity, setIdentity] = useState<IdentityDraft>({
    signature_enabled: true,
    signature_text: workspace.email_signature_text || '',
    signature_html: workspace.email_signature_html || '',
    signature_logo_url: workspace.email_logo_url || ''
  });
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);
  const [schema, setSchema] = useState<SchemaPayload | null>(null);
  const [healthRows, setHealthRows] = useState<HealthRow[]>([]);
  const [status, setStatus] = useState('Settings are loading.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const activeSenders = accounts.filter((account) => ['connected', 'ready'].includes(String(account.status || '').toLowerCase()) && !isPaused(account));
  const pausedSenders = accounts.filter((account) => isPaused(account) || !['connected', 'ready'].includes(String(account.status || '').toLowerCase()));
  const schemaReady = schema?.ready === true;

  async function loadAccounts() {
    const { data, error: loadError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;
    const rows = (data || []) as GmailAccount[];
    setAccounts(rows);
    setDrafts((current) => {
      const next: Record<string, SenderDraft> = {};
      for (const account of rows) next[account.id] = current[account.id] || senderDraft(account);
      return next;
    });
    if (rows.length && !identity.signature_text && !identity.signature_html && !identity.signature_logo_url) {
      const source = rows.find((account) => account.signature_text || account.signature_html || account.signature_logo_url);
      if (source) {
        setIdentity({
          signature_enabled: source.signature_enabled !== false,
          signature_text: String(source.signature_text || ''),
          signature_html: String(source.signature_html || ''),
          signature_logo_url: String(source.signature_logo_url || '')
        });
      }
    }
  }

  async function loadCategories() {
    const { data, error: categoryError } = await supabase
      .from('message_categories')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (categoryError) throw categoryError;
    setCategories((data || []) as MessageCategory[]);
  }

  async function loadWorkspaceSettings() {
    const response = await fetch(`/api/workspace/settings?workspaceId=${encodeURIComponent(workspace.id)}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not load workspace settings.');
    const row = json.workspace || {};
    setAppUrl(row.app_url || (typeof window !== 'undefined' ? window.location.origin : ''));
    setDefaultAudienceCategoryId(row.default_audience_category_id || '');
    setDefaultAudienceCategoryName(row.default_audience_category_name || '');
    setIdentity((current) => ({
      signature_enabled: current.signature_enabled,
      signature_text: current.signature_text || row.email_signature_text || '',
      signature_html: current.signature_html || row.email_signature_html || '',
      signature_logo_url: current.signature_logo_url || row.email_logo_url || ''
    }));
  }

  async function checkOauth() {
    const response = await fetch('/api/gmail/oauth/status');
    const json = await response.json().catch(() => ({}));
    const ready = response.ok && json?.success === true;
    setOauthReady(ready);
    return { ready, detail: ready ? 'Google OAuth environment is ready.' : String(json?.error || 'Google OAuth environment is incomplete.') };
  }

  async function checkSchema() {
    const response = await fetch('/api/health/schema', { cache: 'no-store' });
    const json = (await response.json().catch(() => ({}))) as SchemaPayload;
    setSchema(json);
    return json;
  }

  function handleOauthReturn() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('gmail_connected');
    const oauthError = url.searchParams.get('gmail_error');
    if (connected) {
      setStatus(`Connected Gmail: ${connected}.`);
      url.searchParams.delete('gmail_connected');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      loadAccounts().catch((err) => setError(formatError(err)));
    }
    if (oauthError) {
      setError(oauthError);
      url.searchParams.delete('gmail_error');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }
  }

  function connectGmail() {
    setError('');
    window.location.href = `/api/gmail/oauth/start?workspace_id=${encodeURIComponent(workspace.id)}&return=${encodeURIComponent('/settings')}`;
  }

  function patchDraft(account: GmailAccount, patch: Partial<SenderDraft>) {
    setDrafts((current) => ({ ...current, [account.id]: { ...(current[account.id] || senderDraft(account)), ...patch } }));
  }

  async function saveSender(account: GmailAccount) {
    setBusy(true);
    setError('');
    try {
      const draft = drafts[account.id] || senderDraft(account);
      const dailyMaximum = senderSystemDailyMax(account) || Number(account.deployment_cap || 250);
      const runMaximum = senderSystemRunMax(account) || Number(account.deployment_run_cap || 50);
      const dailyLimit = Math.max(1, Math.min(dailyMaximum, Number(draft.daily_limit || dailyMaximum)));
      const runLimit = Math.max(1, Math.min(runMaximum, dailyLimit, Number(draft.default_run_limit || runMaximum)));
      const { error: updateError } = await supabase
        .from('gmail_accounts')
        .update({
          account_type: draft.account_type || 'gmail',
          daily_limit: dailyLimit,
          default_run_limit: runLimit,
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspace.id)
        .eq('id', account.id);
      if (updateError) throw updateError;
      setStatus(`Saved limits for ${account.email}.`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifySender(account: GmailAccount) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/gmail/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, gmail_account_id: account.id })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Gmail check failed with HTTP ${response.status}`);
      setStatus(`Gmail connection verified for ${json.email || account.email}.`);
      await loadAccounts();
    } catch (err) {
      const message = formatError(err);
      setError(message);
      await supabase
        .from('gmail_accounts')
        .update({ connection_status: 'error', connection_error: message, last_error: message })
        .eq('workspace_id', workspace.id)
        .eq('id', account.id);
      await loadAccounts().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function pauseOrResume(account: GmailAccount) {
    setBusy(true);
    setError('');
    try {
      const paused = isPaused(account);
      let action = paused ? 'resume' : 'pause';
      if (paused && hasActiveHardRestriction(account)) {
        throw new Error(`${account.email} is hard-restricted${account.hard_restricted_until ? ` until ${readableDate(account.hard_restricted_until)}` : ''}. ${account.hard_restriction_reason || ''}`.trim());
      }
      if (paused && isAutomaticSafetyPause(account)) {
        const confirmed = window.confirm(`${account.email} was paused automatically for safety. Resume it in Recovering stage with the warning still active?`);
        if (!confirmed) return;
        action = 'temporary_resume';
      }
      const response = await fetch('/api/gmail/sender-control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, gmail_account_id: account.id, action })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Sender update failed with HTTP ${response.status}`);
      setStatus(action === 'pause' ? `${account.email} was paused.` : `${account.email} was resumed.`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectSender(account: GmailAccount) {
    if (!window.confirm(`Disconnect ${account.email} from Scout?`)) return;
    setBusy(true);
    setError('');
    try {
      const { error: deleteError } = await supabase
        .from('gmail_accounts')
        .delete()
        .eq('workspace_id', workspace.id)
        .eq('id', account.id);
      if (deleteError) throw deleteError;
      setStatus(`${account.email} was disconnected.`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    setLogoBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('workspace_id', workspace.id);
      form.append('logo', file);
      const response = await fetch('/api/assets/logo-upload', { method: 'POST', body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Logo upload failed with HTTP ${response.status}`);
      const logoUrl = String(json.publicUrl || json.logoUrl || json.public_url || json.url || '').trim();
      if (!logoUrl) throw new Error('Logo uploaded but no public URL was returned.');
      setIdentity((current) => ({ ...current, signature_logo_url: logoUrl }));
      setStatus('Logo uploaded. Save the signature to apply it to Scout-sent emails.');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLogoBusy(false);
    }
  }

  async function saveIdentity(syncToGmail = false) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/gmail/signature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          apply_all: true,
          sync_to_gmail: syncToGmail,
          signature_enabled: identity.signature_enabled,
          signature_text: identity.signature_text,
          signature_html: identity.signature_html,
          signature_logo_url: identity.signature_logo_url
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Signature save failed with HTTP ${response.status}`);
      const results = Array.isArray(json.results) ? json.results : [];
      const synced = results.filter((row: any) => row?.sync_status === 'synced').length;
      const failed = results.filter((row: any) => row?.sync_status === 'failed').length;
      const skipped = results.filter((row: any) => row?.sync_status === 'skipped').length;
      const updated = Number(json.updated || 0);
      if (!syncToGmail) {
        setStatus(updated > 0
          ? `Signature and logo saved in Scout for ${updated.toLocaleString()} sender(s).`
          : 'Signature and logo saved as the workspace default.');
      } else {
        setStatus(updated > 0
          ? `Signature saved in Scout for ${updated.toLocaleString()} sender(s) · Gmail synced ${synced}/${updated}${failed ? ` · ${failed} failed` : ''}${skipped ? ` · ${skipped} skipped` : ''}.`
          : 'Signature saved as the workspace default. Connect Gmail to synchronize it.');
      }
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkspace() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          appUrl: appUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
          defaultAudienceCategoryId,
          defaultAudienceCategoryName
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not save workspace settings.');
      setStatus('App and extension setup saved.');
      await Promise.all([loadWorkspaceSettings(), loadCategories()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied.`);
    } catch {
      setError(`Could not copy ${label.toLowerCase()} automatically.`);
    }
  }

  async function runFullCheck() {
    setHealthBusy(true);
    setError('');
    try {
      const [schemaResult, appHealthResponse, leadsResult, templatesResult] = await Promise.all([
        checkSchema(),
        fetch('/api/health', { cache: 'no-store' }),
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['ready', 'found', 'connected'])
          .not('email', 'is', null)
          .neq('email', ''),
        supabase
          .from('templates')
          .select('id,template_type,active')
          .eq('workspace_id', workspace.id)
          .eq('active', true)
          .limit(200)
      ]);
      const appHealth = await appHealthResponse.json().catch(() => ({}));
      const oauth = await checkOauth();
      const templates = (templatesResult.data || []) as Array<{ template_type?: string | null }>;
      const initialTemplates = templates.filter((template) => String(template.template_type || 'initial') === 'initial').length;
      const followupTemplates = templates.filter((template) => String(template.template_type || '') === 'follow_up').length;
      const rows: HealthRow[] = [
        {
          name: 'Supabase schema',
          status: schemaResult.ready ? 'Good' : 'Fix needed',
          detail: schemaResult.ready
            ? `Schema contract ${schemaResult.contractVersion || 'current'} passed. Required tables, columns, and follow-up RPCs are available.`
            : `${schemaResult.missing?.length || 1} database requirement(s) are missing. Run RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql, then check again.`
        },
        {
          name: 'Environment and worker',
          status: appHealth?.environmentReady && appHealth?.workerReady ? 'Good' : 'Fix needed',
          detail: appHealth?.environmentReady && appHealth?.workerReady
            ? 'Supabase server keys, Google OAuth keys, worker secrets, and the message worker are ready.'
            : String(appHealth?.databaseError || appHealth?.centralWorker?.error || 'One or more Vercel environment or worker checks failed.')
        },
        {
          name: 'Google OAuth',
          status: oauth.ready ? 'Good' : 'Fix needed',
          detail: oauth.detail
        },
        {
          name: 'Gmail senders',
          status: activeSenders.length > 0 ? 'Good' : 'Fix needed',
          detail: `${activeSenders.length} active sender(s), ${pausedSenders.length} paused, restricted, or disconnected.`
        },
        {
          name: 'Contactable leads',
          status: Number(leadsResult.count || 0) > 0 ? 'Good' : 'Warning',
          detail: `${Number(leadsResult.count || 0).toLocaleString()} ready/found/connected lead(s) with email.`
        },
        {
          name: 'Templates',
          status: initialTemplates > 0 ? 'Good' : 'Fix needed',
          detail: `${initialTemplates} active initial template(s), ${followupTemplates} follow-up template(s).`
        },
        {
          name: 'Reply intelligence',
          status: VERIFICATION_SEND_ONLY ? 'Warning' : 'Good',
          detail: VERIFICATION_SEND_ONLY
            ? 'Reply synchronization is disabled by configuration.'
            : 'Inbox reply classification is active.'
        }
      ];
      setHealthRows(rows);
      setStatus(rows.some((row) => row.status === 'Fix needed')
        ? 'Check complete. Fix the red items before sending.'
        : 'Check complete. Core sending setup is ready.');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setHealthBusy(false);
    }
  }

  useEffect(() => {
    if (!appUrl && typeof window !== 'undefined') setAppUrl(window.location.origin);
    handleOauthReturn();
    Promise.allSettled([
      loadWorkspaceSettings(),
      loadCategories(),
      loadAccounts(),
      checkOauth(),
      checkSchema()
    ]).then((results) => {
      const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failure) setError(formatError(failure.reason));
      else setStatus('Settings loaded. Run the full check before a large campaign.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const extensionBase = (appUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  const extensionIngestUrl = `${extensionBase}/api/extension/ingest`;

  return (
    <div className="stack">
      {error ? <div className="error">{error}</div> : null}
      <div className="success">{status}</div>

      <div className="grid grid-3">
        <div className="card kpi">
          <div className="title">Database</div>
          <div className="num">{schema === null ? '…' : schemaReady ? 'Ready' : 'Fix'}</div>
          <p className="muted">Schema contract {schema?.contractVersion || 'checking'}</p>
        </div>
        <div className="card kpi">
          <div className="title">Active Senders</div>
          <div className="num">{activeSenders.length}</div>
          <p className="muted">{pausedSenders.length} need attention</p>
        </div>
        <div className="card kpi">
          <div className="title">Google OAuth</div>
          <div className="num">{oauthReady === null ? '…' : oauthReady ? 'Ready' : 'Fix'}</div>
          <p className="muted">Send, reply reading, and Gmail signature permissions</p>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar">
          <div>
            <h3>Setup Readiness</h3>
            <p className="muted">One check confirms the current Supabase tables and columns, follow-up functions, Vercel environment, worker, OAuth, senders, leads, and templates.</p>
          </div>
          <button className="btn" type="button" disabled={healthBusy} onClick={runFullCheck}>
            {healthBusy ? 'Checking…' : 'Run full check'}
          </button>
        </div>

        {!schemaReady && schema ? (
          <div className="error" style={{ marginTop: 12 }}>
            <strong>Database update required.</strong>
            <div style={{ marginTop: 6 }}>Run <code>RUN_THIS_ONE_SQL_IN_CURRENT_SUPABASE.sql</code>, then return here and click Run full check.</div>
            {schema.missing?.length ? (
              <details style={{ marginTop: 8 }}>
                <summary>Show missing database requirements</summary>
                <ul>{schema.missing.slice(0, 12).map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {healthRows.length ? (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Area</th><th>Status</th><th>What Scout confirmed</th></tr></thead>
              <tbody>
                {healthRows.map((row) => (
                  <tr key={row.name}>
                    <td><strong>{row.name}</strong></td>
                    <td><span className={`status ${toneClass(row.status)}`}>{row.status}</span></td>
                    <td>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="notice" style={{ marginTop: 12 }}>Run the full check after every code or SQL update. Scout will show a red Database status when a required table, column, or RPC is missing.</div>
        )}

        <div className="warning" style={{ marginTop: 12 }}>
          <strong>Replies in this build:</strong> automatic Scout-thread synchronization is active after each Gmail sender reconnects with reply-reading permission. Scout classifies real replies, automatic responses, no-inbox notices, blocked messages, bounces, Gmail sending-limit notices, temporary failures, and unsubscribes. Unrelated inbox conversations are ignored.
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="topbar">
          <div>
            <h3>Gmail Senders</h3>
            <p className="muted">Connect Gmail, verify access, and set preferred limits. Scout still enforces the lower health and deployment limits automatically.</p>
          </div>
          <div className="actions">
            <button className="btn" type="button" disabled={busy || !schemaReady} onClick={connectGmail}>Connect Gmail</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => loadAccounts().catch((err) => setError(formatError(err)))}>Refresh</button>
          </div>
        </div>

        {!schemaReady ? <div className="notice" style={{ marginTop: 12 }}>Gmail connection is disabled until the database schema check passes.</div> : null}

        <div className="stack" style={{ marginTop: 14 }}>
          {accounts.map((account) => {
            const draft = drafts[account.id] || senderDraft(account);
            const paused = isPaused(account);
            const hardRestricted = hasActiveHardRestriction(account);
            const connection = String(account.connection_status || ((account.access_token || account.refresh_token) ? 'not checked' : 'needs reconnect'));
            const reason = account.hard_restriction_reason || account.paused_reason || account.health_reason || 'Checkpoint-controlled sender health.';
            return (
              <div className="card" key={account.id} style={{ padding: 14 }}>
                <div className="topbar">
                  <div>
                    <strong>{account.email}</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      <span className={`status ${connection === 'verified' ? 'connected' : connection === 'error' ? 'error' : 'paused'}`}>{connection}</span>{' '}
                      <span className={`status ${paused ? 'paused' : 'connected'}`}>{hardRestricted ? 'Hard restricted' : paused ? 'Paused' : 'Active'}</span>{' '}
                      <span>Health: {humanStage(account.health_stage)}</span>
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn secondary" type="button" disabled={busy} onClick={() => verifySender(account)}>Check Gmail</button>
                    <button className="btn secondary" type="button" disabled={busy || hardRestricted} onClick={() => pauseOrResume(account)}>{paused ? 'Resume' : 'Pause'}</button>
                  </div>
                </div>

                <div className="grid grid-3" style={{ marginTop: 12 }}>
                  <div>
                    <label className="label">Preferred daily maximum</label>
                    <input className="input" type="number" min={1} max={senderSystemDailyMax(account) || 250} value={draft.daily_limit} onChange={(event) => patchDraft(account, { daily_limit: event.target.value })} />
                    <p className="muted" style={{ marginTop: 5 }}>System allowance: {senderSystemDailyMax(account).toLocaleString()}/24h</p>
                  </div>
                  <div>
                    <label className="label">Preferred maximum per run</label>
                    <input className="input" type="number" min={1} max={senderSystemRunMax(account) || 50} value={draft.default_run_limit} onChange={(event) => patchDraft(account, { default_run_limit: event.target.value })} />
                    <p className="muted" style={{ marginTop: 5 }}>System run allowance: {senderSystemRunMax(account).toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="label">Account type</label>
                    <select className="select" value={draft.account_type} onChange={(event) => patchDraft(account, { account_type: event.target.value })}>
                      <option value="gmail">Gmail</option>
                      <option value="workspace">Google Workspace</option>
                      <option value="other">Other</option>
                    </select>
                    <button className="btn" style={{ marginTop: 8 }} type="button" disabled={busy} onClick={() => saveSender(account)}>Save limits</button>
                  </div>
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary>Connection and safety details</summary>
                  <div className="notice" style={{ marginTop: 8 }}>
                    <div><strong>Reason:</strong> {reason}</div>
                    <div><strong>Lifetime sent:</strong> {Number(account.lifetime_sent || account.successful_sends || account.sent_today || 0).toLocaleString()}</div>
                    <div><strong>Real replies recorded:</strong> {Number(account.real_replies || 0).toLocaleString()}</div>
                    {account.connection_verified_at ? <div><strong>Last Gmail check:</strong> {readableDate(account.connection_verified_at)}</div> : null}
                    <div><strong>Permissions:</strong> {account.oauth_reconnect_required ? 'Reconnect required' : 'Send + Scout-thread replies + Gmail signature'}</div>
                    {account.last_reply_sync_at ? <div><strong>Last reply sync:</strong> {readableDate(account.last_reply_sync_at)} · {account.last_reply_sync_status || 'ok'}</div> : <div><strong>Last reply sync:</strong> Not run yet</div>}
                    {account.last_reply_sync_error ? <div className="error"><strong>Reply sync:</strong> {account.last_reply_sync_error}</div> : null}
                    {account.gmail_signature_synced_at ? <div><strong>Gmail signature synced:</strong> {readableDate(account.gmail_signature_synced_at)}</div> : null}
                    {account.gmail_signature_sync_error ? <div className="error"><strong>Signature sync:</strong> {account.gmail_signature_sync_error}</div> : null}
                    {account.hard_restricted_until ? <div><strong>Restriction ends:</strong> {readableDate(account.hard_restricted_until)}</div> : null}
                    {account.connection_error ? <div className="error" style={{ marginTop: 8 }}>{account.connection_error}</div> : null}
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button className="btn secondary" type="button" disabled={busy} onClick={() => disconnectSender(account)}>Disconnect from Scout</button>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
          {!accounts.length ? <div className="notice">No Gmail accounts connected. Run the database check, then click Connect Gmail.</div> : null}
        </div>
      </div>

      <details className="card" style={{ padding: 18 }}>
        <summary><strong>Email Identity & Signature</strong> <span className="muted">— shared across Scout-sent emails</span></summary>
        <div style={{ marginTop: 14 }}>
          <label className="checkbox-row"><input type="checkbox" checked={identity.signature_enabled} onChange={(event) => setIdentity((current) => ({ ...current, signature_enabled: event.target.checked }))} /> Add this signature to Scout-sent emails</label>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Plain signature</label>
              <textarea className="textarea" style={{ minHeight: 120 }} value={identity.signature_text} onChange={(event) => setIdentity((current) => ({ ...current, signature_text: event.target.value }))} placeholder={'Best regards,\nYour name\nWebsite'} />
            </div>
            <div>
              <label className="label">HTML signature, optional</label>
              <textarea className="textarea" style={{ minHeight: 120 }} value={identity.signature_html} onChange={(event) => setIdentity((current) => ({ ...current, signature_html: event.target.value }))} placeholder={'<strong>Your name</strong><br />Website'} />
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Upload logo</label>
              <input className="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={logoBusy || busy} onChange={(event) => uploadLogo(event.target.files?.[0] || null)} />
            </div>
            <div>
              <label className="label">Public logo URL</label>
              <input className="input" value={identity.signature_logo_url} onChange={(event) => setIdentity((current) => ({ ...current, signature_logo_url: event.target.value }))} />
            </div>
          </div>
          {identity.signature_logo_url ? <img src={identity.signature_logo_url} alt="Signature logo preview" style={{ maxWidth: 160, height: 'auto', marginTop: 12, borderRadius: 8 }} /> : null}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy || logoBusy || !schemaReady} onClick={() => saveIdentity(false)}>Save signature &amp; logo</button>
            <button className="btn secondary" type="button" disabled={busy || logoBusy || !schemaReady} onClick={() => saveIdentity(true)}>Save + sync to Gmail</button>
            {identity.signature_logo_url ? <button className="btn secondary" type="button" onClick={() => copyText(identity.signature_logo_url, 'Logo URL')}>Copy logo URL</button> : null}
          </div>
          <div className="notice" style={{ marginTop: 10 }}>Save signature & logo always stores the signature in Scout. Save + sync to Gmail additionally updates the native Gmail signature for connected senders that granted Gmail signature permission.</div>
        </div>
      </details>

      <details className="card" style={{ padding: 18 }}>
        <summary><strong>App & Extension Setup</strong> <span className="muted">— URL, workspace key, and default audience</span></summary>
        <div style={{ marginTop: 14 }}>
          <div className="grid grid-2">
            <div>
              <label className="label">Scout App / Vercel URL</label>
              <input className="input" value={appUrl} onChange={(event) => setAppUrl(event.target.value)} placeholder="https://your-scout-app.vercel.app" />
            </div>
            <div>
              <label className="label">Default audience category</label>
              <select className="select" value={defaultAudienceCategoryId} onChange={(event) => {
                setDefaultAudienceCategoryId(event.target.value);
                const category = categories.find((row) => row.id === event.target.value);
                if (category) setDefaultAudienceCategoryName(category.name);
              }}>
                <option value="">None / create a new category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="label">New default category name</label>
              <input className="input" value={defaultAudienceCategoryName} onChange={(event) => {
                setDefaultAudienceCategoryName(event.target.value);
                if (defaultAudienceCategoryId) setDefaultAudienceCategoryId('');
              }} placeholder="Website design" />
            </div>
            <div>
              <label className="label">Workspace key</label>
              <div className="actions">
                <input className="input" readOnly value={workspace.api_key || 'Missing — run the current Supabase SQL'} />
                {workspace.api_key ? <button className="btn secondary" type="button" onClick={() => copyText(workspace.api_key || '', 'Workspace key')}>Copy</button> : null}
              </div>
            </div>
          </div>
          <label className="label" style={{ marginTop: 12 }}>Extension ingest URL</label>
          <div className="actions">
            <input className="input" readOnly value={extensionIngestUrl} />
            <button className="btn secondary" type="button" disabled={!extensionBase} onClick={() => copyText(extensionIngestUrl, 'Extension ingest URL')}>Copy</button>
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy || !schemaReady} onClick={saveWorkspace}>Save app setup</button>
          </div>
        </div>
      </details>
    </div>
  );
}
