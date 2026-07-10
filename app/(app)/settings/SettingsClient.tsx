'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GmailAccount, MessageCategory, SeedInboxTest, Workspace } from '@/lib/types';

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
};

function shortenSignature(account: GmailAccount) {
  const text = String(account.signature_text || account.signature_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'No signature';
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}


export default function SettingsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const identityLoadedRef = useRef(false);
  const [appUrl, setAppUrl] = useState(workspace.app_url || '');
  const [backendUrl, setBackendUrl] = useState(workspace.render_backend_url || process.env.NEXT_PUBLIC_BACKEND_URL || '');
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [defaultAudienceCategoryId, setDefaultAudienceCategoryId] = useState(workspace.default_audience_category_id || '');
  const [defaultAudienceCategoryName, setDefaultAudienceCategoryName] = useState(workspace.default_audience_category_name || '');
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [seedTests, setSeedTests] = useState<SeedInboxTest[]>([]);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, { daily_limit: string; default_run_limit: string; account_type: string; seed_inbox_enabled: boolean; seed_test_address: string }>>({});
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft>({ signature_enabled: true, signature_text: '', signature_html: '' });
  const [manualEmail, setManualEmail] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('Connect Gmail here. Message uses only connected senders from this page.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);

  async function loadAccounts() {
    const { data, error: loadError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;
    const rows = (data || []) as GmailAccount[];
    setAccounts(rows);
    if (!identityLoadedRef.current && rows.length) {
      const source = rows.find((account) => account.signature_text || account.signature_html) || rows[0];
      setIdentityDraft({
        signature_enabled: source.signature_enabled !== false,
        signature_text: String(source.signature_text || ''),
        signature_html: String(source.signature_html || '')
      });
      identityLoadedRef.current = true;
    }
    setLimitDrafts((current) => {
      const next: Record<string, { daily_limit: string; default_run_limit: string; account_type: string; seed_inbox_enabled: boolean; seed_test_address: string }> = {};
      for (const account of rows) {
        const existing = current[account.id];
        next[account.id] = existing || {
          daily_limit: String(account.daily_limit || 150),
          default_run_limit: String(account.default_run_limit || Math.min(Number(account.daily_limit || 150), 100)),
          account_type: String(account.account_type || 'gmail'),
          seed_inbox_enabled: Boolean(account.seed_inbox_enabled),
          seed_test_address: String(account.seed_test_address || account.email || '')
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
        setStatus('Gmail OAuth is ready. Connect Gmail should work from this page.');
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
    const dailyLimit = Math.max(1, Math.min(50000, Number(draft?.daily_limit || account.daily_limit || 150)));
    const defaultRunLimit = Math.max(1, Math.min(dailyLimit, Number(draft?.default_run_limit || account.default_run_limit || Math.min(dailyLimit, 100))));
    return {
      account_type: draft?.account_type || account.account_type || 'gmail',
      daily_limit: dailyLimit,
      default_run_limit: defaultRunLimit,
      seed_inbox_enabled: Boolean(draft?.seed_inbox_enabled),
      seed_test_address: normalizeEmail(draft?.seed_test_address || account.seed_test_address || account.email),
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
          signature_html: identityDraft.signature_html
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Signature save failed with HTTP ${response.status}`);
      const failed = (json?.results || []).filter((row: Record<string, unknown>) => row.sync_status === 'failed');
      setStatus(syncToGmail
        ? failed.length
          ? `Saved signature in Scout for all senders. Gmail sync failed for ${failed.length} sender(s); reconnect after this version if Google asks for the Gmail settings permission.`
          : `Saved in Scout and synced to Gmail for ${Number(json.updated || 0).toLocaleString()} sender(s).`
        : `Saved Scout signature for ${Number(json.updated || 0).toLocaleString()} sender(s).`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSeedInbox(account: GmailAccount, enabled: boolean) {
    const draft = limitDrafts[account.id] || {
      daily_limit: String(account.daily_limit || 150),
      default_run_limit: String(account.default_run_limit || 100),
      account_type: String(account.account_type || 'gmail'),
      seed_inbox_enabled: Boolean(account.seed_inbox_enabled),
      seed_test_address: String(account.seed_test_address || account.email || '')
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
      setStatus('Saving sender/seed settings, then running seed inbox test...');
      await saveAllSenderDrafts();
      await loadAccounts();
      const response = await fetch('/api/gmail/seed-test/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, mode: 'send_and_check' })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Seed test failed with HTTP ${response.status}`);
      setStatus(`Seed test complete. Sent ${Number(json.sent || 0)} test(s). Inbox ${Number(json.inbox || 0)}, spam ${Number(json.spam || 0)}, promotions ${Number(json.promotions || 0)}, not found/pending ${Number(json.not_found || 0)}. If a result says not found, run the check again after a minute.`);
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

  function saveLocalBackend() {
    localStorage.setItem('scout_v8_backend_url', backendUrl);
    setStatus('Optional backend URL saved locally. Native Gmail OAuth/send is handled by this app.');
  }

  useEffect(() => {
    const savedBackend = localStorage.getItem('scout_v8_backend_url');
    if (savedBackend && !backendUrl) setBackendUrl(savedBackend);
    if (!appUrl && typeof window !== 'undefined') setAppUrl(window.location.origin);
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
        <div className="card kpi"><div className="title">Connected Senders</div><div className="num">{accounts.filter((a) => a.status === 'connected' && !isPaused(a)).length}</div></div>
        <div className="card kpi"><div className="title">Paused / Limited</div><div className="num">{accounts.filter((a) => a.status !== 'connected' || isPaused(a)).length}</div></div>
        <div className="card kpi"><div className="title">OAuth</div><div className="num">{oauthReady === null ? '…' : oauthReady ? 'Ready' : 'Fix'}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Gmail Senders</h3>
        <p className="muted">Connect Gmail once here. Message will use these connected senders for selected or rotated sending.</p>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={busy} onClick={connectGmail}>Connect Gmail</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={checkGmailOauth}>Check OAuth setup</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={loadAccounts}>Refresh senders</button>
        </div>

        <button className="btn secondary" type="button" style={{ marginTop: 12 }} onClick={() => setShowAdvanced((v) => !v)}>Advanced manual sender</button>
        {showAdvanced ? <div className="card" style={{ padding: 12, marginTop: 10 }}>
          <p className="muted">Use this only for testing. Normal setup should use Connect Gmail.</p>
          <div className="grid grid-2">
            <div><label className="label">Sender email</label><input className="input" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="sender@gmail.com" /></div>
            <div><label className="label">Refresh token</label><input className="input" value={manualRefreshToken} onChange={(e) => setManualRefreshToken(e.target.value)} /></div>
          </div>
          <label className="label" style={{ marginTop: 10 }}>Access token</label>
          <input className="input" value={manualAccessToken} onChange={(e) => setManualAccessToken(e.target.value)} />
          <button className="btn secondary" type="button" style={{ marginTop: 10 }} disabled={busy} onClick={addManualAccount}>Add / Update Sender</button>
        </div> : null}

        <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Email</th><th>Status</th><th>Limits</th><th>Seed receiver</th><th>Today / Risk</th><th>Actions</th></tr></thead><tbody>
          {accounts.map((account) => {
            const draft = limitDrafts[account.id] || { daily_limit: String(account.daily_limit || 150), default_run_limit: String(account.default_run_limit || 100), account_type: String(account.account_type || 'gmail'), seed_inbox_enabled: Boolean(account.seed_inbox_enabled), seed_test_address: String(account.seed_test_address || account.email || '') };
            return <tr key={account.id}>
              <td><strong>{account.email}</strong><br /><span className="muted">{account.last_error || (account.paused_until ? `Paused until ${new Date(account.paused_until).toLocaleString()}` : 'Ready')}</span></td>
              <td><span className={`status ${isPaused(account) ? 'paused' : account.status}`}>{isPaused(account) ? 'paused' : account.status}</span><br /><select className="select" value={draft.account_type} onChange={(e) => setLimitDrafts((cur) => ({ ...cur, [account.id]: { ...draft, account_type: e.target.value } }))}><option value="gmail">Gmail</option><option value="workspace">Workspace</option><option value="custom">Custom</option></select></td>
              <td><div className="grid grid-2"><div><label className="label">Daily safe limit</label><input className="input" type="number" min={1} value={draft.daily_limit} onChange={(e) => setLimitDrafts((cur) => ({ ...cur, [account.id]: { ...draft, daily_limit: e.target.value } }))} /></div><div><label className="label">Default max/run</label><input className="input" type="number" min={1} value={draft.default_run_limit} onChange={(e) => setLimitDrafts((cur) => ({ ...cur, [account.id]: { ...draft, default_run_limit: e.target.value } }))} /></div></div></td>
              <td><label className="checkbox-row"><input type="checkbox" checked={draft.seed_inbox_enabled} onChange={(e) => toggleSeedInbox(account, e.target.checked)} /> Use as seed receiver</label><input className="input" value={draft.seed_test_address} onChange={(e) => setLimitDrafts((cur) => ({ ...cur, [account.id]: { ...draft, seed_test_address: e.target.value } }))} placeholder="seed inbox email" /></td>
              <td>{Number(account.sent_today || 0).toLocaleString()} / {Number(account.daily_limit || 0).toLocaleString()}<br /><span className="badge">{account.spam_risk_status || account.last_seed_result || 'unknown'}</span><br /><span className="muted">Signature: {account.signature_enabled === false ? 'off' : account.signature_text || account.signature_html ? 'on' : 'empty'}</span></td>
              <td><button className="btn secondary" type="button" disabled={busy} onClick={() => saveSenderSettings(account)}>Save sender settings</button> <button className="btn secondary" type="button" disabled={busy || !(account.access_token || account.refresh_token)} onClick={() => verifySenderProfile(account)}>Verify</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => pauseOrResume(account)}>{isPaused(account) || account.status !== 'connected' ? 'Resume' : 'Pause'}</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => removeAccount(account)}>Remove</button></td>
            </tr>;
          })}
          {!accounts.length ? <tr><td colSpan={6} className="muted">No senders connected yet. Click Connect Gmail, approve permissions, and this table should update after Google redirects back.</td></tr> : null}
        </tbody></table></div>
        <div className="actions" style={{ marginTop: 12 }}><button className="btn secondary" type="button" disabled={busy} onClick={runSeedTestNow}>Run seed inbox test now</button><span className="muted">Seed receiver checkboxes save automatically. For real testing, connect at least 2 Gmail accounts so they can test each other.</span></div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Sender</th><th>Seed receiver</th><th>Placement</th><th>Checked</th></tr></thead><tbody>
          {seedTests.map((row) => <tr key={row.id}><td>{row.sender_email}</td><td>{row.seed_email}</td><td><span className={`status ${row.placement || 'pending'}`}>{row.placement || 'pending'}</span></td><td>{row.checked_at || row.created_at ? new Date(row.checked_at || row.created_at || '').toLocaleString() : '-'}</td></tr>)}
          {!seedTests.length ? <tr><td colSpan={4} className="muted">No seed inbox tests yet. Turn on Use as seed receiver for one account, then click Run seed inbox test now. You need at least 2 connected Gmail accounts for cross-account testing.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Email Identity & Signatures</h3>
        <p className="muted">Use one shared signature across all connected sender accounts. Scout automatically appends the signature to initial messages, follow-ups, and manual replies.</p>
        <label className="checkbox-row" style={{ marginTop: 10 }}><input type="checkbox" checked={identityDraft.signature_enabled} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_enabled: event.target.checked }))} /> Add this signature to Scout-sent emails</label>
        <label className="label" style={{ marginTop: 12 }}>Plain signature</label>
        <textarea className="textarea" value={identityDraft.signature_text} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_text: event.target.value }))} placeholder={"Best regards,\nOlalekan\nWebsite: https://example.com"} style={{ minHeight: 110 }} />
        <label className="label" style={{ marginTop: 12 }}>HTML signature, optional</label>
        <textarea className="textarea" value={identityDraft.signature_html} onChange={(event) => setIdentityDraft((draft) => ({ ...draft, signature_html: event.target.value }))} placeholder={'<strong>Olalekan</strong><br />Founder, Elevate Scout<br /><a href="https://example.com">example.com</a>'} style={{ minHeight: 110 }} />
        <div className="notice" style={{ marginTop: 10 }}>
          Scout controls email signatures. Actual Gmail/Google profile pictures must be changed directly inside each Google account.
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" disabled={busy || !accounts.length} onClick={() => applyEmailIdentity(false)}>Save to Scout for all senders</button>
          <button className="btn secondary" type="button" disabled={busy || !accounts.length} onClick={() => applyEmailIdentity(true)}>Save + sync signature to Gmail</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Sender</th><th>Signature</th><th>Gmail sync</th></tr></thead><tbody>
          {accounts.map((account) => <tr key={`identity-${account.id}`}><td>{account.email}</td><td>{account.signature_enabled === false ? 'Disabled' : shortenSignature(account)}</td><td>{account.gmail_signature_sync_error ? <span className="error">Failed: {account.gmail_signature_sync_error}</span> : account.gmail_signature_synced_at ? `Synced ${new Date(account.gmail_signature_synced_at).toLocaleString()}` : 'Not synced'}</td></tr>)}
          {!accounts.length ? <tr><td colSpan={3} className="muted">Connect Gmail first, then save the shared signature.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Admin Setup for Team + Extension</h3>
        <p className="muted">Save these once so another person can open the app, go to Settings, connect Gmail, and start scouting. The Render/backend URL is optional unless you still use a separate Render service for deep workers.</p>
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
    </div>
  );
}
