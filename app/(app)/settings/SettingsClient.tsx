'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GmailAccount, MessageCategory, SeedInboxTest, Workspace } from '@/lib/types';

const MANUAL_GMAIL_TOKEN_ENTRY_ENABLED = process.env.NEXT_PUBLIC_MANUAL_GMAIL_TOKEN_ENTRY_ENABLED === 'true';

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error?: string; reason?: string };
    return [value.message || value.error, value.reason, value.code ? `Code: ${value.code}` : '', value.details, value.hint].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

function isPaused(account: GmailAccount) {
  if (!account.paused_until) return false;
  return new Date(account.paused_until).getTime() > Date.now();
}

type IdentityDraft = {
  signature_enabled: boolean;
  signature_text: string;
  signature_html: string;
  signature_logo_url: string;
};

type HealthRow = {
  name: string;
  status: "Good" | "Warning" | "Fix needed";
  detail: string;
};


type SenderDraft = {
  daily_limit: string;
  default_run_limit: string;
  account_type: string;
  seed_inbox_enabled: boolean;
  seed_test_address: string;
  sending_mode: 'warmup' | 'normal' | 'fast';
  health_status: string;
  warmup_daily_cap: string;
};

function shortenSignature(account: GmailAccount) {
  const text = String(account.signature_text || account.signature_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'No signature';
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}


export default function SettingsClient({ workspace, isAdmin = false, nativeSignatureSyncEnabled = false, placementTestsEnabled = true }: { workspace: Workspace; isAdmin?: boolean; nativeSignatureSyncEnabled?: boolean; placementTestsEnabled?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const identityLoadedRef = useRef(false);
  const [appUrl, setAppUrl] = useState(workspace.app_url || '');
  const [backendUrl, setBackendUrl] = useState(workspace.render_backend_url || process.env.NEXT_PUBLIC_BACKEND_URL || '');
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [defaultAudienceCategoryId, setDefaultAudienceCategoryId] = useState(workspace.default_audience_category_id || '');
  const [defaultAudienceCategoryName, setDefaultAudienceCategoryName] = useState(workspace.default_audience_category_name || '');
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [accountPage, setAccountPage] = useState(1);
  const [accountTotalPages, setAccountTotalPages] = useState(1);
  const [accountMatching, setAccountMatching] = useState(0);
  const [accountSummary, setAccountSummary] = useState({ total: 0, connected: 0, paused: 0 });
  const [sentTotalByEmail, setSentTotalByEmail] = useState<Record<string, number>>({});
  const [seedTests, setSeedTests] = useState<SeedInboxTest[]>([]);
  const [seedSenderId, setSeedSenderId] = useState('');
  const [seedReceiverId, setSeedReceiverId] = useState('');
  const [limitDrafts, setLimitDrafts] = useState<Record<string, SenderDraft>>({});
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft>({ signature_enabled: true, signature_text: workspace.email_signature_text || '', signature_html: workspace.email_signature_html || '', signature_logo_url: workspace.email_logo_url || '' });
  const [logoUploadBusy, setLogoUploadBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('Connect Gmail here. Message uses only connected senders from this page.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);
  const [healthRows, setHealthRows] = useState<HealthRow[]>([]);
  const [healthBusy, setHealthBusy] = useState(false);
  const [workspaceTimezone, setWorkspaceTimezone] = useState(workspace.timezone || 'UTC');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function loadAccounts(options?: { page?: number; search?: string; filter?: string }) {
    const requestedPage = Math.max(1, options?.page ?? accountPage);
    const requestedSearch = options?.search ?? accountSearch;
    const requestedFilter = options?.filter ?? accountFilter;
    const params = new URLSearchParams({
      workspaceId: workspace.id,
      page: String(requestedPage),
      pageSize: '25',
      search: requestedSearch,
      filter: requestedFilter,
    });
    const response = await fetch(`/api/gmail/accounts?${params.toString()}`, { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not load Gmail senders.');
    const rows = (Array.isArray(json.accounts) ? json.accounts : []) as GmailAccount[];
    setAccounts(rows);
    setAccountPage(Number(json?.pagination?.page || requestedPage));
    setAccountTotalPages(Math.max(1, Number(json?.pagination?.totalPages || 1)));
    setAccountMatching(Number(json?.pagination?.matching || 0));
    setAccountSummary({
      total: Number(json?.summary?.total || 0),
      connected: Number(json?.summary?.connected || 0),
      paused: Number(json?.summary?.paused || 0),
    });
    setSentTotalByEmail(Object.fromEntries(rows.map((account) => [normalizeEmail(account.email), Number(account.lifetime_sent || 0)])));
    setSeedSenderId((current) => rows.some((row) => row.id === current) ? current : (rows.find((row) => row.status === 'connected' && !isPaused(row))?.id || rows[0]?.id || ''));
    setSeedReceiverId((current) => rows.some((row) => row.id === current) ? current : (rows.find((row) => row.id !== rows[0]?.id)?.id || ''));

    if (!identityLoadedRef.current && rows.length) {
      const source = rows.find((account) => account.signature_text || account.signature_html || account.signature_logo_url) || rows[0];
      setIdentityDraft({
        signature_enabled: source.signature_enabled !== false,
        signature_text: String(source.signature_text || ''),
        signature_html: String(source.signature_html || ''),
        signature_logo_url: String(source.signature_logo_url || workspace.email_logo_url || '')
      });
      identityLoadedRef.current = true;
    }
    setLimitDrafts((current) => {
      const next = { ...current };
      for (const account of rows) {
        next[account.id] = current[account.id] || {
          daily_limit: String(account.daily_limit || 250),
          default_run_limit: String(account.default_run_limit || Math.min(Number(account.daily_limit || 250), 50)),
          account_type: String(account.account_type || 'gmail'),
          seed_inbox_enabled: Boolean(account.seed_inbox_enabled),
          seed_test_address: String(account.seed_test_address || account.email || ''),
          sending_mode: (['warmup', 'normal', 'fast'].includes(String(account.sending_mode || '')) ? String(account.sending_mode) : 'normal') as SenderDraft['sending_mode'],
          health_status: String(account.health_status || 'needs_review'),
          warmup_daily_cap: String(account.warmup_daily_cap || '')
        };
      }
      return next;
    });
  }

  async function loadSeedTests() {
    const { data, error: loadError } = await supabase
      .from('seed_inbox_tests')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (loadError) {
      if (String(loadError.message || '').includes('seed_inbox_tests')) return;
      throw loadError;
    }
    setSeedTests((data || []) as SeedInboxTest[]);
  }

  async function checkGmailOauth() {
    try {
      const response = await fetch('/api/gmail/oauth/status');
      const json = await response.json().catch(() => ({}));
      setOauthReady(Boolean(json?.success));
      if (json?.success) {
        setStatus('Gmail OAuth is ready. Connect Gmail requests sending access only.');
      } else {
        setStatus('Gmail OAuth is not ready yet. Check the project environment setup, then redeploy.');
      }
    } catch (err) {
      setOauthReady(false);
      setStatus(`OAuth setup check failed: ${formatError(err)}`);
    }
  }

  async function checkBackend() {
    try {
      const response = await fetch('/api/backend/gmail/status');
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || json?.message || `Backend returned HTTP ${response.status}`);
      setStatus(json?.endpoints?.send_selected_batch ? 'Optional backend connected. Native Gmail OAuth/send is still handled by this app.' : 'Optional backend responded. Native Gmail OAuth/send is handled by this app.');
    } catch (err) {
      setStatus(`Optional backend check failed: ${formatError(err)}`);
    }
  }

  async function saveGmailAccount(input: { email: string; access_token?: string; refresh_token?: string; status?: string; raw?: Record<string, unknown> }) {
    const email = normalizeEmail(input.email);
    if (!email) throw new Error('Gmail email is required.');
    const payload = {
      workspace_id: workspace.id,
      email,
      display_name: email,
      status: input.status || 'connected',
      access_token: input.access_token || null,
      refresh_token: input.refresh_token || null,
      client_id: null,
      expires_at: null,
      raw: input.raw || {}
    };
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert(payload, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;
  }

  function handleReturnNotice() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('gmail_connected');
    const oauthError = url.searchParams.get('gmail_error');
    if (connected) {
      setStatus(`Connected Gmail: ${connected}. It should now appear in the sender list below.`);
      url.searchParams.delete('gmail_connected');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      loadAccounts().catch((err) => setError(formatError(err)));
    loadSeedTests().catch(() => undefined);
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

  async function addManualAccount() {
    setBusy(true);
    setError('');
    try {
      await saveGmailAccount({
        email: manualEmail,
        access_token: manualAccessToken || undefined,
        refresh_token: manualRefreshToken || undefined,
        status: manualAccessToken || manualRefreshToken ? 'connected' : 'needs_token',
        raw: { added_manually: true, added_at: new Date().toISOString() }
      });
      setManualEmail('');
      setManualAccessToken('');
      setManualRefreshToken('');
      setStatus('Manual sender saved. OAuth connection is preferred.');
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifySenderProfile(account: GmailAccount) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/gmail/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, gmail_account_id: account.id })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || json?.message || `Profile check failed with HTTP ${response.status}`);
      setStatus(`Verified sender: ${json.email || account.email}`);
      await loadAccounts();
    } catch (err) {
      const msg = formatError(err);
      setError(msg);
      await supabase.from('gmail_accounts').update({ status: 'error', last_error: msg }).eq('workspace_id', workspace.id).eq('id', account.id);
      await loadAccounts();
    } finally {
      setBusy(false);
    }
  }

  function senderSettingsPatch(account: GmailAccount) {
    const draft = limitDrafts[account.id];
    const dailyLimit = Math.max(1, Math.min(2000, Number(draft?.daily_limit || account.daily_limit || 250)));
    const defaultRunLimit = Math.max(1, Math.min(dailyLimit, Number(draft?.default_run_limit || account.default_run_limit || Math.min(dailyLimit, 50))));
    return {
      account_type: draft?.account_type || account.account_type || 'gmail',
      daily_limit: dailyLimit,
      default_run_limit: defaultRunLimit,
      seed_inbox_enabled: Boolean(draft?.seed_inbox_enabled),
      seed_test_address: normalizeEmail(draft?.seed_test_address || account.seed_test_address || account.email),
      sending_mode: (draft?.sending_mode || account.sending_mode || 'normal') === 'fast' && String(account.health_status || '') !== 'healthy'
        ? 'normal'
        : (draft?.sending_mode || account.sending_mode || 'normal'),
      health_status: draft?.health_status || account.health_status || 'needs_review',
      warmup_daily_cap: draft?.warmup_daily_cap ? Math.max(1, Math.min(250, Number(draft.warmup_daily_cap))) : null,
      warmup_started_at: (draft?.sending_mode || account.sending_mode) === 'warmup' ? (account.warmup_started_at || new Date().toISOString()) : account.warmup_started_at || null,
      updated_at: new Date().toISOString()
    };
  }

  async function saveSenderSettings(account: GmailAccount, quiet = false) {
    if (!quiet) {
      setBusy(true);
      setError('');
    }
    try {
      const { error: updateError } = await supabase
        .from('gmail_accounts')
        .update(senderSettingsPatch(account))
        .eq('workspace_id', workspace.id)
        .eq('id', account.id);
      if (updateError) throw updateError;
      if (!quiet) {
        setStatus(`Saved sender settings for ${account.email}.`);
        await loadAccounts();
      }
    } catch (err) {
      if (!quiet) setError(formatError(err));
      throw err;
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  async function saveAllSenderDrafts() {
    const rows = accounts.filter((account) => limitDrafts[account.id]);
    for (const account of rows) await saveSenderSettings(account, true);
  }


  async function uploadSignatureLogo(file: File | null) {
    if (!file) return;
    setLogoUploadBusy(true);
    setLogoMessage('Uploading logo…');
    setError('');
    try {
      const form = new FormData();
      form.append('workspace_id', workspace.id);
      form.append('logo', file);
      const response = await fetch('/api/assets/logo-upload', {
        method: 'POST',
        body: form
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Logo upload failed with HTTP ${response.status}`);
      const logoUrl = String(json.publicUrl || json.logoUrl || json.public_url || json.url || '').trim();
      if (!logoUrl) throw new Error('Logo uploaded but no public URL was returned.');
      setIdentityDraft((draft) => ({ ...draft, signature_logo_url: logoUrl }));
      setLogoMessage('Logo uploaded and saved as the workspace default. The public URL is now shown below. Click Save to Scout to apply it to sender accounts.');
      setStatus('Logo uploaded. Public URL is visible in the Logo URL box. Click Save to Scout to apply it to Scout emails.');
    } catch (err) {
      const message = formatError(err);
      setLogoMessage(`Logo upload failed: ${message}`);
      setError(message);
    } finally {
      setLogoUploadBusy(false);
    }
  }

  async function copyLogoUrl() {
    const url = identityDraft.signature_logo_url.trim();
    if (!url) {
      setLogoMessage('No logo URL to copy yet. Upload a logo first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setLogoMessage('Logo URL copied.');
    } catch {
      setLogoMessage('Could not copy automatically. Select the URL and copy it manually.');
    }
  }


  async function copySignatureForGmail() {
    const plain = identityDraft.signature_text.trim() || identityDraft.signature_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain && !identityDraft.signature_html.trim()) {
      setError('Add a signature before copying it.');
      return;
    }
    try {
      if (typeof ClipboardItem !== 'undefined' && identityDraft.signature_html.trim()) {
        const item = new ClipboardItem({
          'text/html': new Blob([identityDraft.signature_html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setStatus('Signature copied. Paste it into Gmail Settings → See all settings → General → Signature.');
    } catch {
      setError('Could not copy automatically. Select the signature text and copy it manually.');
    }
  }

  async function saveTimezone() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace/timezone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, timezone: workspaceTimezone })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not save timezone.');
      setStatus(`Workspace timezone saved as ${json.timezone}. Sent today now uses this timezone.`);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteScoutAccount() {
    if (deleteConfirm !== 'DELETE') {
      setError('Type DELETE exactly before permanently deleting the account.');
      return;
    }
    if (!window.confirm('Permanently delete this Scout account, Gmail connections, jobs, leads, templates, history, and workspace data? This cannot be undone.')) return;
    setDeleteBusy(true);
    setError('');
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteConfirm })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Account deletion failed.');
      await supabase.auth.signOut();
      window.location.href = '/?account_deleted=1';
    } catch (err) {
      setError(formatError(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function applyEmailIdentity(syncToGmail = false) {
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
          signature_enabled: identityDraft.signature_enabled,
          signature_text: identityDraft.signature_text,
          signature_html: identityDraft.signature_html,
          signature_logo_url: identityDraft.signature_logo_url
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Signature save failed with HTTP ${response.status}`);
      const failed = (json?.results || []).filter((row: Record<string, unknown>) => row.sync_status === 'failed');
      setStatus(json?.sync_deferred
        ? 'Saved in Scout. Gmail-native signature sync will be enabled after advanced Google authorization.'
        : syncToGmail
        ? failed.length
          ? `Saved signature in Scout for all senders. Gmail sync failed for ${failed.length} sender(s); reconnect after this version if Google asks for the Gmail settings permission.`
          : `Saved in Scout and synced to Gmail for ${Number(json.updated || 0).toLocaleString()} sender(s).`
        : Number(json.updated || 0) > 0 ? `Saved Scout signature and logo for ${Number(json.updated || 0).toLocaleString()} sender(s).` : 'Saved workspace signature and logo. Connect Gmail to apply it to sender accounts.');
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSeedInbox(account: GmailAccount, enabled: boolean) {
    const draft = limitDrafts[account.id] || {
      daily_limit: String(account.daily_limit || 250),
      default_run_limit: String(account.default_run_limit || 50),
      account_type: String(account.account_type || 'gmail'),
      seed_inbox_enabled: Boolean(account.seed_inbox_enabled),
      seed_test_address: String(account.seed_test_address || account.email || ''),
      sending_mode: (['warmup', 'normal', 'fast'].includes(String(account.sending_mode || '')) ? String(account.sending_mode) : 'normal') as SenderDraft['sending_mode'],
      health_status: String(account.health_status || 'needs_review'),
      warmup_daily_cap: String(account.warmup_daily_cap || '')
    };
    setLimitDrafts((cur) => ({ ...cur, [account.id]: { ...draft, seed_inbox_enabled: enabled } }));
    setStatus(enabled ? `Seed receiver enabled for ${account.email}. Click Run seed inbox test now to check placement.` : `Seed receiver disabled for ${account.email}.`);
    try {
      const { error: updateError } = await supabase
        .from('gmail_accounts')
        .update({
          seed_inbox_enabled: enabled,
          seed_test_address: normalizeEmail(draft.seed_test_address || account.email),
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspace.id)
        .eq('id', account.id);
      if (updateError) throw updateError;
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function runSeedTestNow() {
    setBusy(true);
    setError('');
    try {
      if (!seedSenderId || !seedReceiverId) throw new Error('Choose one sender and one different test receiver.');
      if (seedSenderId === seedReceiverId) throw new Error('The sender and test receiver must be different inboxes.');
      const response = await fetch('/api/gmail/seed-test/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, action: 'send', sender_account_id: seedSenderId, seed_account_id: seedReceiverId })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Placement test failed with HTTP ${response.status}`);
      setStatus(json?.message || 'One placement test was sent. Open the receiving inbox and record where it arrived.');
      await Promise.all([loadAccounts(), loadSeedTests()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function recordSeedPlacement(testId: string, placement: 'inbox' | 'promotions' | 'spam' | 'not_received') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/gmail/seed-test/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, action: 'record', test_id: testId, placement })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not save the placement result.');
      setStatus(`Placement recorded as ${placement.replace('_', ' ')}.`);
      await Promise.all([loadAccounts(), loadSeedTests()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function pauseOrResume(account: GmailAccount) {
    setBusy(true);
    try {
      const paused = isPaused(account) || account.status === 'paused' || account.status === 'limit_hit';
      const update = paused ? { status: 'connected', paused_until: null, last_error: null } : { status: 'paused', paused_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), last_error: 'Paused manually' };
      const { error: updateError } = await supabase.from('gmail_accounts').update(update).eq('workspace_id', workspace.id).eq('id', account.id);
      if (updateError) throw updateError;
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(account: GmailAccount) {
    if (!window.confirm(`Remove ${account.email} from Scout senders?`)) return;
    setBusy(true);
    try {
      const { error: deleteError } = await supabase.from('gmail_accounts').delete().eq('workspace_id', workspace.id).eq('id', account.id);
      if (deleteError) throw deleteError;
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
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
    try {
      const response = await fetch(`/api/workspace/settings?workspaceId=${encodeURIComponent(workspace.id)}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not load workspace settings.');
      const row = json.workspace || {};
      setAppUrl(row.app_url || (typeof window !== 'undefined' ? window.location.origin : ''));
      setBackendUrl(row.render_backend_url || process.env.NEXT_PUBLIC_BACKEND_URL || '');
      setDefaultAudienceCategoryId(row.default_audience_category_id || '');
      setDefaultAudienceCategoryName(row.default_audience_category_name || '');
    } catch (err) {
      setStatus(`Workspace setup load note: ${formatError(err)}`);
    }
  }

  async function saveWorkspaceSettings() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          appUrl: appUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
          renderBackendUrl: backendUrl,
          defaultAudienceCategoryId,
          defaultAudienceCategoryName
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || 'Could not save workspace settings.');
      setStatus('Workspace setup saved. Your team can now use Settings → Connect Gmail and the extension can read the saved app/backend URLs.');
      await Promise.all([loadWorkspaceSettings(), loadCategories()]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function healthStatus(ok: boolean, warn: boolean = false): "Good" | "Warning" | "Fix needed" {
    if (ok) return "Good";
    return warn ? "Warning" : "Fix needed";
  }

  async function runAppHealthCheck() {
    setHealthBusy(true);
    setError('');
    try {
      const since72 = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const [readyCount, emailCount, templateRows, connectedSenderCount, dueScheduleCount, researchQueueCount, signatureCheck] = await Promise.all([
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['ready', 'found', 'connected'])
          .not('email', 'is', null)
          .neq('email', ''),
        supabase
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('email', 'is', null)
          .neq('email', ''),
        supabase
          .from('templates')
          .select('id,name,template_type,active')
          .eq('workspace_id', workspace.id)
          .eq('active', true)
          .limit(200),
        supabase
          .from('gmail_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['connected', 'ready']),
        supabase
          .from('message_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['scheduled', 'due', 'running']),
        supabase
          .from('email_research_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['queued', 'running']),
        supabase
          .from('workspaces')
          .select('email_signature_text,email_signature_html,email_logo_url,app_url')
          .eq('id', workspace.id)
          .maybeSingle(),
      ]);

      let dueFollowupDetail = 'RPC not checked.';
      let dueFollowupOk = true;
      try {
        const { data: dueData, error: dueError } = await supabase.rpc('get_due_followups', {
          target_workspace: workspace.id,
          limit_rows: 1,
          followup_segment: 'all_unanswered'
        });
        if (dueError) throw dueError;
        dueFollowupDetail = `${Array.isArray(dueData) ? dueData.length : 0} due sample loaded. RPC is available.`;
      } catch (err) {
        dueFollowupOk = false;
        dueFollowupDetail = `Follow-up RPC problem: ${formatError(err)}`;
      }

      const templates = (templateRows.data || []) as Array<{ template_type?: string | null }>;
      const initialTemplates = templates.filter((t) => String(t.template_type || 'initial') === 'initial').length;
      const followupTemplates = templates.filter((t) => String(t.template_type || '') === 'follow_up').length;
      const sig = (signatureCheck.data || {}) as Record<string, any>;
      const rows: HealthRow[] = [
        {
          name: 'Contactable leads',
          status: healthStatus(Number(readyCount.count || 0) > 0, Number(emailCount.count || 0) > 0),
          detail: `${Number(readyCount.count || 0).toLocaleString()} ready/found/connected with email. ${Number(emailCount.count || 0).toLocaleString()} total leads have email.`
        },
        {
          name: 'Gmail senders',
          status: healthStatus(Number(connectedSenderCount.count || 0) > 0),
          detail: `${Number(connectedSenderCount.count || 0).toLocaleString()} connected sender(s).`
        },
        {
          name: 'Templates',
          status: healthStatus(initialTemplates > 0, followupTemplates === 0),
          detail: `${initialTemplates} initial template(s), ${followupTemplates} follow-up template(s).`
        },
        {
          name: 'Open-app schedules',
          status: 'Good',
          detail: `${Number(dueScheduleCount.count || 0).toLocaleString()} active saved schedule(s). The central worker continues due schedules even when Scout is closed.`
        },
        {
          name: 'Due follow-ups',
          status: dueFollowupOk ? 'Good' : 'Fix needed',
          detail: dueFollowupDetail
        },
        {
          name: 'Auto Scout queue',
          status: 'Good',
          detail: `${Number(researchQueueCount.count || 0).toLocaleString()} queued/running research job(s). Auto Scout runs when you start it from the app.`
        },
        {
          name: 'Signature/logo',
          status: healthStatus(Boolean(sig.email_signature_text || sig.email_signature_html || sig.email_logo_url), true),
          detail: `${sig.email_logo_url ? 'Logo saved.' : 'No logo saved.'} ${sig.email_signature_text || sig.email_signature_html ? 'Signature saved.' : 'No signature text/html saved.'}`
        },
        {
          name: 'Speed mode',
          status: 'Good',
          detail: 'Cron routes are not part of the normal flow. Polling is throttled, sender counts use one grouped read, and lists load in small pages.'
        },
      ];
      setHealthRows(rows);
      setStatus('Health check complete. Fix anything marked Fix needed before a large campaign.');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setHealthBusy(false);
    }
  }

  function saveLocalBackend() {
    localStorage.setItem('scout_v8_backend_url', backendUrl);
    setStatus('Optional backend URL saved locally. Native Gmail OAuth/send is handled by this app.');
  }

  useEffect(() => {
    const savedBackend = localStorage.getItem('scout_v8_backend_url');
    if (savedBackend && !backendUrl) setBackendUrl(savedBackend);
    if (!appUrl && typeof window !== 'undefined') setAppUrl(window.location.origin);
    if (typeof window !== 'undefined' && (!workspace.timezone || workspace.timezone === 'UTC')) {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setWorkspaceTimezone(detected);
    }
    loadWorkspaceSettings();
    loadCategories().catch((err) => setError(formatError(err)));
    loadAccounts().catch((err) => setError(formatError(err)));
    loadSeedTests().catch(() => undefined);
    checkGmailOauth();
    checkBackend();
    handleReturnNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  return (
    <div className="stack">
      {error ? <div className="error">{error}</div> : null}
      <div className="success">{status}</div>

      <div className="grid grid-3">
        <div className="card kpi"><div className="title">Connected Senders</div><div className="num">{accountSummary.connected}</div></div>
        <div className="card kpi"><div className="title">Paused / Limited</div><div className="num">{accountSummary.paused}</div></div>
        <div className="card kpi"><div className="title">OAuth</div><div className="num">{oauthReady === null ? '…' : oauthReady ? 'Ready' : 'Fix'}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>App Health Check</h3>
        <p className="muted">Quick check before sending: leads, senders, templates, follow-ups, schedules, Auto Scout, signature, and speed mode.</p>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={healthBusy} onClick={runAppHealthCheck}>{healthBusy ? 'Checking…' : 'Run health check'}</button>
        </div>
        {healthRows.length ? <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Area</th><th>Status</th><th>Detail</th></tr></thead><tbody>
          {healthRows.map((row) => <tr key={row.name}><td>{row.name}</td><td><span className={`status ${row.status === 'Good' ? 'connected' : row.status === 'Warning' ? 'paused' : 'error'}`}>{row.status}</span></td><td>{row.detail}</td></tr>)}
        </tbody></table></div> : <div className="notice" style={{ marginTop: 12 }}>Run this after deployment. It gives a clear reason if sending, follow-ups, logo, or Auto Scout will fail.</div>}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Sent today timezone</h3>
        <p className="muted">Scout uses this timezone to calculate midnight and the Sent today counter. The rolling 24-hour safety limit still works in the background.</p>
        <div className="actions" style={{ marginTop: 12 }}>
          <input className="input" style={{ maxWidth: 340 }} value={workspaceTimezone} onChange={(event) => setWorkspaceTimezone(event.target.value)} placeholder="Africa/Lagos" />
          <button className="btn secondary" type="button" disabled={busy} onClick={saveTimezone}>Save timezone</button>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Gmail Senders</h3>
        <p className="muted">Connect Gmail once, choose a simple safety mode, and send normally. Scout handles pacing and limits in the background.</p>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={busy} onClick={connectGmail}>Connect Gmail</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={checkGmailOauth}>Check OAuth setup</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => loadAccounts()}>Refresh senders</button>
        </div>

        {MANUAL_GMAIL_TOKEN_ENTRY_ENABLED ? <>
          <button className="btn secondary" type="button" style={{ marginTop: 12 }} onClick={() => setShowAdvanced((v) => !v)}>Advanced manual sender</button>
          {showAdvanced ? <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <p className="muted">Testing only. Normal users should use Connect Gmail.</p>
            <div className="grid grid-2">
              <div><label className="label">Sender email</label><input className="input" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="sender@gmail.com" /></div>
              <div><label className="label">Refresh token</label><input className="input" value={manualRefreshToken} onChange={(e) => setManualRefreshToken(e.target.value)} /></div>
            </div>
            <label className="label" style={{ marginTop: 10 }}>Access token</label>
            <input className="input" value={manualAccessToken} onChange={(e) => setManualAccessToken(e.target.value)} />
            <button className="btn secondary" type="button" style={{ marginTop: 10 }} disabled={busy} onClick={addManualAccount}>Add / Update Sender</button>
          </div> : null}
        </> : null}

        <div className="notice" style={{ marginTop: 12 }}>
          <strong>Simple safety modes:</strong> Warm-up is slowest for new or recovering accounts, Normal is recommended for everyday outreach, and Fast keeps the existing 3-second lane for healthy accounts.
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <input className="input" style={{ maxWidth: 320 }} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') loadAccounts({ page: 1, search: accountSearch, filter: accountFilter }).catch((err) => setError(formatError(err))); }} placeholder="Search connected Gmail" />
          <select className="select" style={{ maxWidth: 220 }} value={accountFilter} onChange={(event) => { const value = event.target.value; setAccountFilter(value); loadAccounts({ page: 1, search: accountSearch, filter: value }).catch((err) => setError(formatError(err))); }}>
            <option value="all">All senders</option>
            <option value="connected">Connected</option>
            <option value="healthy">Healthy</option>
            <option value="warming">Warming / recovering</option>
            <option value="paused">Paused</option>
            <option value="limited">Provider limited</option>
          </select>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => loadAccounts({ page: 1, search: accountSearch, filter: accountFilter }).catch((err) => setError(formatError(err)))}>Search</button>
          <span className="muted">{accountMatching.toLocaleString()} matching · {accountSummary.total.toLocaleString()} connected records</span>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Email</th><th>Safety</th><th>Capacity</th><th>Usage</th><th>Actions</th></tr></thead><tbody>
          {accounts.map((account) => {
            const draft: SenderDraft = limitDrafts[account.id] || {
              daily_limit: String(account.daily_limit || 250),
              default_run_limit: String(account.default_run_limit || 50),
              account_type: String(account.account_type || 'gmail'),
              seed_inbox_enabled: Boolean(account.seed_inbox_enabled),
              seed_test_address: String(account.seed_test_address || account.email || ''),
              sending_mode: 'normal',
              health_status: String(account.health_status || 'needs_review'),
              warmup_daily_cap: String(account.warmup_daily_cap || '')
            };
            return <tr key={account.id}>
              <td><strong>{account.email}</strong><br /><span className="muted">{account.last_error || (account.paused_until ? `Paused until ${new Date(account.paused_until).toLocaleString()}` : 'Ready')}</span></td>
              <td>
                <span className={`status ${isPaused(account) ? 'paused' : account.status}`}>{isPaused(account) ? 'paused' : account.status}</span>
                <label className="label" style={{ marginTop: 8 }}>Sending mode</label>
                <select className="select" value={draft.sending_mode} onChange={(event) => setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, sending_mode: event.target.value as SenderDraft['sending_mode'] } }))}>
                  <option value="warmup">Warm-up / Recovery</option>
                  <option value="normal">Normal (recommended)</option>
                  <option value="fast" disabled={String(account.health_status || '') !== 'healthy'}>Fast (after healthy test)</option>
                </select>
                {draft.sending_mode === 'warmup' ? <><label className="label" style={{ marginTop: 8 }}>Warm-up cap, optional</label><input className="input sender-limit-input" type="number" min={1} max={250} value={draft.warmup_daily_cap} onChange={(event) => setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, warmup_daily_cap: event.target.value } }))} placeholder="Automatic" /></> : null}
                <span className="muted" style={{ display: 'block', marginTop: 6 }}>Health: {String(account.health_status || draft.health_status || 'needs review').replace(/_/g, ' ')}</span>
              </td>
              <td className="sender-limits-cell"><div className="sender-limits-grid"><div><label className="label">Daily maximum</label><input className="input sender-limit-input" type="number" inputMode="numeric" min={1} max={2000} value={draft.daily_limit} placeholder="250" required aria-label={`Daily maximum for ${account.email}`} onBlur={(event) => { if (!event.target.value.trim()) setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, daily_limit: '250' } })); }} onChange={(event) => setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, daily_limit: event.target.value } }))} /><span className="muted sender-limit-hint">Default 250; safety mode may lower it.</span></div><div><label className="label">Maximum per run</label><input className="input sender-limit-input" type="number" inputMode="numeric" min={1} max={250} value={draft.default_run_limit} placeholder="50" required aria-label={`Maximum per run for ${account.email}`} onBlur={(event) => { if (!event.target.value.trim()) setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, default_run_limit: '50' } })); }} onChange={(event) => setLimitDrafts((current) => ({ ...current, [account.id]: { ...draft, default_run_limit: event.target.value } }))} /><span className="muted sender-limit-hint">Default 50 for each explicit Send command.</span></div></div></td>
              <td><strong>{Number(account.sent_today || 0).toLocaleString()}</strong><br /><span className="muted">sent today</span><br /><strong>{Number(account.sent_rolling_24h || 0).toLocaleString()}</strong><br /><span className="muted">rolling 24h</span><br /><strong>{Number(sentTotalByEmail[normalizeEmail(account.email)] ?? 0).toLocaleString()}</strong><br /><span className="muted">lifetime through Scout</span></td>
              <td><button className="btn secondary" type="button" disabled={busy} onClick={() => saveSenderSettings(account)}>Save</button> <button className="btn secondary" type="button" disabled={busy || account.has_credentials === false} onClick={() => verifySenderProfile(account)}>Verify</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => pauseOrResume(account)}>{isPaused(account) || account.status !== 'connected' ? 'Resume' : 'Pause'}</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => removeAccount(account)}>Remove</button></td>
            </tr>;
          })}
          {!accounts.length ? <tr><td colSpan={5} className="muted">No senders connected yet. Click Connect Gmail and approve sending access.</td></tr> : null}
        </tbody></table></div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" disabled={busy || accountPage <= 1} onClick={() => loadAccounts({ page: accountPage - 1 }).catch((err) => setError(formatError(err)))}>Previous</button>
          <span className="muted">Page {accountPage.toLocaleString()} of {accountTotalPages.toLocaleString()}</span>
          <button className="btn secondary" type="button" disabled={busy || accountPage >= accountTotalPages} onClick={() => loadAccounts({ page: accountPage + 1 }).catch((err) => setError(formatError(err)))}>Next</button>
        </div>
        {placementTestsEnabled ? <details style={{ marginTop: 14 }}>
          <summary><strong>Optional placement test</strong></summary>
          <p className="muted" style={{ marginTop: 8 }}>Send one controlled test between two inboxes you own. Scout does not read the receiving inbox; you record where the message arrived.</p>
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div><label className="label">Send from</label><select className="select" value={seedSenderId} onChange={(event) => { setSeedSenderId(event.target.value); if (event.target.value === seedReceiverId) setSeedReceiverId(accounts.find((row) => row.id !== event.target.value)?.id || ''); }}><option value="">Choose sender</option>{accounts.filter((row) => row.status === 'connected' && !isPaused(row)).map((row) => <option key={`sender-${row.id}`} value={row.id}>{row.email}</option>)}</select></div>
            <div><label className="label">Receive in</label><select className="select" value={seedReceiverId} onChange={(event) => setSeedReceiverId(event.target.value)}><option value="">Choose test inbox</option>{accounts.filter((row) => row.id !== seedSenderId).map((row) => <option key={`receiver-${row.id}`} value={row.id}>{row.email}</option>)}</select></div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}><button className="btn secondary" type="button" disabled={busy || !seedSenderId || !seedReceiverId || seedSenderId === seedReceiverId} onClick={runSeedTestNow}>Send one test</button></div>
          {seedTests.length ? <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Sender</th><th>Receiver</th><th>Result</th><th>Record placement</th></tr></thead><tbody>{seedTests.map((row) => <tr key={row.id}><td>{row.sender_email}</td><td>{row.seed_email}</td><td><span className={`status ${row.placement || 'pending'}`}>{String(row.placement || 'awaiting check').replace(/_/g, ' ')}</span></td><td><div className="actions"><button className="btn secondary" type="button" disabled={busy} onClick={() => recordSeedPlacement(row.id, 'inbox')}>Inbox</button><button className="btn secondary" type="button" disabled={busy} onClick={() => recordSeedPlacement(row.id, 'promotions')}>Promotions</button><button className="btn secondary" type="button" disabled={busy} onClick={() => recordSeedPlacement(row.id, 'spam')}>Spam</button><button className="btn secondary" type="button" disabled={busy} onClick={() => recordSeedPlacement(row.id, 'not_received')}>Not received</button></div></td></tr>)}</tbody></table></div> : null}
        </details> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Email Identity & Signatures</h3>
        <p className="muted">Use one shared signature across all connected sender accounts. Scout automatically appends the signature to initial messages, follow-ups, and manual replies.</p>
        <label className="checkbox-row" style={{ marginTop: 10 }}><input type="checkbox" checked={identityDraft.signature_enabled} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_enabled: event.target.checked }))} /> Add this signature to Scout-sent emails</label>
        <label className="label" style={{ marginTop: 12 }}>Plain signature</label>
        <textarea className="textarea" value={identityDraft.signature_text} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_text: event.target.value }))} placeholder={"Best regards,\nOlalekan\nWebsite: https://example.com"} style={{ minHeight: 110 }} />
        <label className="label" style={{ marginTop: 12 }}>HTML signature, optional</label>
        <textarea className="textarea" value={identityDraft.signature_html} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_html: event.target.value }))} placeholder={'<strong>Olalekan</strong><br />Founder, Elevate Scout<br /><a href="https://example.com">example.com</a>'} style={{ minHeight: 110 }} />
        <label className="label" style={{ marginTop: 12 }}>Logo after signature</label>
        <div className="grid grid-2">
          <div>
            <input
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={logoUploadBusy || busy}
              onChange={(event) => uploadSignatureLogo(event.target.files?.[0] || null)}
            />
            <p className="muted" style={{ marginTop: 6 }}>Upload PNG/JPG/WebP. Recommended 320×120 px, transparent PNG, under 2 MB.</p>
            {logoMessage ? <p className={logoMessage.toLowerCase().includes('failed') ? 'error' : 'success'} style={{ marginTop: 6 }}>{logoMessage}</p> : null}
          </div>
          <div>
            <label className="label">Public logo URL</label>
            <input className="input" value={identityDraft.signature_logo_url} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_logo_url: event.target.value }))} placeholder="Logo URL appears here after upload" />
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn secondary" type="button" disabled={!identityDraft.signature_logo_url.trim()} onClick={copyLogoUrl}>Copy URL</button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>{logoUploadBusy ? 'Uploading logo…' : 'After upload, click Save to Scout below.'}</p>
          </div>
        </div>
        {identityDraft.signature_logo_url ? <div style={{ marginTop: 10 }}><img src={identityDraft.signature_logo_url} alt="Signature logo preview" style={{ maxWidth: 160, height: 'auto', borderRadius: 8 }} /></div> : null}
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={busy} onClick={() => applyEmailIdentity(false)}>Save to Scout</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={copySignatureForGmail}>Copy signature for Gmail</button>
          {nativeSignatureSyncEnabled ? <button className="btn secondary" type="button" disabled={busy || !accounts.length} onClick={() => applyEmailIdentity(true)}>Save to Scout & sync to Gmail</button> : null}
        </div>
        {!nativeSignatureSyncEnabled ? <p className="muted" style={{ marginTop: 10 }}>Scout-sent emails include this signature exactly once. Use Copy signature for Gmail for direct replies until advanced Gmail authorization is enabled.</p> : null}
        <details style={{ marginTop: 12 }}>
          <summary><strong>View signature status per sender</strong></summary>
          <div className="table-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Sender</th><th>Signature</th><th>Gmail sync</th></tr></thead><tbody>
            {accounts.map((account) => <tr key={`identity-${account.id}`}><td>{account.email}</td><td>{account.signature_enabled === false ? 'Disabled' : shortenSignature(account)}</td><td>{account.gmail_signature_sync_error ? <span className="error">Failed: {account.gmail_signature_sync_error}</span> : account.gmail_signature_synced_at ? `Synced ${new Date(account.gmail_signature_synced_at).toLocaleString()}` : 'Not synced'}</td></tr>)}
            {!accounts.length ? <tr><td colSpan={3} className="muted">Connect Gmail first, then save the shared signature.</td></tr> : null}
          </tbody></table></div>
        </details>
      </div>

      {isAdmin ? (
        <div className="card" style={{ padding: 18 }}>
          <h3>Admin Setup for Team + Extension</h3>
          <p className="muted">Only the main admin can change these shared setup values. New users receive these defaults automatically, but they cannot change the team setup.</p>
          <div className="grid grid-2">
            <div><label className="label">Scout App URL / Vercel URL</label><input className="input" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://your-scout-app.vercel.app" /></div>
            <div><label className="label">Render / backend URL, optional</label><input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://your-render-backend.onrender.com" /></div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div><label className="label">Default audience category</label><select className="select" value={defaultAudienceCategoryId} onChange={(e) => { setDefaultAudienceCategoryId(e.target.value); const cat = categories.find((c) => c.id === e.target.value); if (cat) setDefaultAudienceCategoryName(cat.name); }}><option value="">None / create below</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label">New default category name</label><input className="input" value={defaultAudienceCategoryName} onChange={(e) => { setDefaultAudienceCategoryName(e.target.value); if (defaultAudienceCategoryId) setDefaultAudienceCategoryId(''); }} placeholder="Airtable service, Marketing, Shopify audit" /></div>
          </div>
          <div className="notice" style={{ marginTop: 12 }}>Extension ingest URL: <code>{(appUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/extension/ingest</code></div>
          <label className="label" style={{ marginTop: 12 }}>Extension workspace key</label>
          <input className="input" readOnly value={workspace.api_key || 'No API key found. Re-run migration.'} />
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy} onClick={saveWorkspaceSettings}>Save admin setup</button>
            <button className="btn secondary" type="button" onClick={saveLocalBackend}>Save backend locally too</button>
            <button className="btn secondary" type="button" onClick={checkBackend}>Check backend</button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 18 }}>
          <h3>Team setup</h3>
          <p className="muted">The main admin manages the shared app URL, backend URL, and extension setup. Your account uses those values automatically. Use this page for your Gmail senders, signature, and sending limits.</p>
        </div>
      )}

      {!isAdmin ? <div className="card" style={{ padding: 18, borderColor: '#d98c8c' }}>
        <h3>Delete this account</h3>
        <p className="muted">Permanently removes this Scout account, Gmail connections, jobs, templates, leads, and history. Anonymous team duplicate fingerprints remain so previously contacted businesses are not recycled.</p>
        <label className="label" style={{ marginTop: 10 }}>Type DELETE to confirm</label>
        <div className="actions"><input className="input" style={{ maxWidth: 220 }} value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" /><button className="btn secondary" type="button" disabled={deleteBusy || deleteConfirm !== 'DELETE'} onClick={deleteScoutAccount}>{deleteBusy ? 'Deleting…' : 'Delete permanently'}</button></div>
      </div> : null}
    </div>
  );
}
