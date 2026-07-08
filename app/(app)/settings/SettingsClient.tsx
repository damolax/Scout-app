'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { GmailAccount, Workspace } from '@/lib/types';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'].join(' ');

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

function getSettingsRedirectUri() {
  if (typeof window === 'undefined') return '/settings';
  return `${window.location.origin}/settings`;
}

export default function SettingsClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [backendUrl, setBackendUrl] = useState(process.env.NEXT_PUBLIC_BACKEND_URL || '');
  const [googleClientId, setGoogleClientId] = useState('');
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [manualEmail, setManualEmail] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('Connect Gmail here. Message only uses the connected senders.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAccounts() {
    const { data, error: loadError } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;
    setAccounts((data || []) as GmailAccount[]);
  }

  async function checkBackend() {
    try {
      const response = await fetch('/api/backend/gmail/status');
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || json?.message || `Backend returned HTTP ${response.status}`);
      setStatus(json?.endpoints?.send_selected_batch ? 'Backend connected. Gmail sending route is visible.' : 'Backend connected. Confirm Gmail routes before sending.');
    } catch (err) {
      setStatus(`Backend check failed: ${formatError(err)}`);
    }
  }

  async function saveGmailAccount(input: { email: string; access_token?: string; refresh_token?: string; client_id?: string; expires_in?: number; status?: string; raw?: Record<string, unknown> }) {
    const email = normalizeEmail(input.email);
    if (!email) throw new Error('Gmail email is required.');
    const expiresAt = input.expires_in ? new Date(Date.now() + Number(input.expires_in) * 1000).toISOString() : null;
    const payload = {
      workspace_id: workspace.id,
      email,
      display_name: email,
      status: input.status || 'connected',
      access_token: input.access_token || null,
      refresh_token: input.refresh_token || null,
      client_id: input.client_id || googleClientId || null,
      expires_at: expiresAt,
      raw: input.raw || {}
    };
    const { error: upsertError } = await supabase.from('gmail_accounts').upsert(payload, { onConflict: 'workspace_id,email' });
    if (upsertError) throw upsertError;
  }

  async function handleOauthReturn() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || state !== 'scout_v818_gmail') return;
    const clientId = googleClientId || localStorage.getItem('scout_v818_google_client_id') || '';
    if (!clientId) {
      setError('Google returned a code, but the OAuth Client ID is missing. Save it and reconnect Gmail.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/backend/gmail/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, client_id: clientId, redirect_uri: getSettingsRedirectUri() })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || json?.message || `Gmail exchange failed with HTTP ${response.status}`);
      await saveGmailAccount({
        email: json.email,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        client_id: clientId,
        expires_in: json.expires_in,
        status: 'connected',
        raw: { scope: json.scope, connected_at: new Date().toISOString(), redirect_uri: getSettingsRedirectUri() }
      });
      url.searchParams.delete('code');
      url.searchParams.delete('scope');
      url.searchParams.delete('state');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      setStatus(`Connected Gmail: ${json.email}`);
      await loadAccounts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function startGmailOauth() {
    const clientId = googleClientId.trim();
    if (!clientId) {
      setError('Paste your Google OAuth Client ID first.');
      return;
    }
    localStorage.setItem('scout_v818_google_client_id', clientId);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', getSettingsRedirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_SCOPES);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', 'scout_v818_gmail');
    window.location.href = url.toString();
  }

  async function addManualAccount() {
    setBusy(true);
    setError('');
    try {
      await saveGmailAccount({
        email: manualEmail,
        access_token: manualAccessToken || undefined,
        refresh_token: manualRefreshToken || undefined,
        client_id: googleClientId || undefined,
        status: manualAccessToken || manualRefreshToken ? 'connected' : 'needs_token',
        raw: { added_manually: true, added_at: new Date().toISOString() }
      });
      setManualEmail('');
      setManualAccessToken('');
      setManualRefreshToken('');
      setStatus('Sender saved.');
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
      const response = await fetch('/api/backend/gmail/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: account.access_token, refresh_token: account.refresh_token, client_id: account.client_id || googleClientId })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || json?.message || `Profile check failed with HTTP ${response.status}`);
      const update: Record<string, unknown> = { status: 'connected', email: normalizeEmail(json.email || account.email), display_name: normalizeEmail(json.email || account.email), last_error: null };
      if (json.access_token) update.access_token = json.access_token;
      const { error: updateError } = await supabase.from('gmail_accounts').update(update).eq('workspace_id', workspace.id).eq('id', account.id);
      if (updateError) throw updateError;
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

  function saveLocalBackend() {
    localStorage.setItem('scout_v8_backend_url', backendUrl);
    setStatus('Backend URL saved locally. Keep NEXT_PUBLIC_BACKEND_URL set in Vercel for all devices.');
  }

  useEffect(() => {
    const savedBackend = localStorage.getItem('scout_v8_backend_url');
    const savedClientId = localStorage.getItem('scout_v818_google_client_id') || localStorage.getItem('scout_v815_google_client_id') || '';
    if (savedBackend) setBackendUrl(savedBackend);
    if (savedClientId) setGoogleClientId(savedClientId);
    loadAccounts().catch((err) => setError(formatError(err)));
    checkBackend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    handleOauthReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  return (
    <div className="stack">
      {error ? <div className="error">{error}</div> : null}
      <div className="success">{status}</div>

      <div className="grid grid-3">
        <div className="card kpi"><div className="title">Connected Senders</div><div className="num">{accounts.filter((a) => a.status === 'connected' && !isPaused(a)).length}</div></div>
        <div className="card kpi"><div className="title">Paused / Limited</div><div className="num">{accounts.filter((a) => a.status !== 'connected' || isPaused(a)).length}</div></div>
        <div className="card kpi"><div className="title">Backend</div><div className="num">{backendUrl ? 'Set' : '—'}</div></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Gmail Senders</h3>
        <div className="grid grid-2">
          <div>
            <label className="label">Google OAuth Client ID</label>
            <input className="input" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder="Paste OAuth Client ID once" />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn" type="button" disabled={busy} onClick={startGmailOauth}>Connect Gmail</button>
          </div>
        </div>
        <div className="notice" style={{ marginTop: 12 }}>Authorized redirect URI in Google Cloud: <strong>{typeof window !== 'undefined' ? `${window.location.origin}/settings` : '/settings'}</strong></div>
        <button className="btn secondary" type="button" style={{ marginTop: 12 }} onClick={() => setShowAdvanced((v) => !v)}>Advanced manual sender</button>
        {showAdvanced ? <div className="card" style={{ padding: 12, marginTop: 10 }}>
          <div className="grid grid-2">
            <div><label className="label">Sender email</label><input className="input" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="sender@gmail.com" /></div>
            <div><label className="label">Refresh token</label><input className="input" value={manualRefreshToken} onChange={(e) => setManualRefreshToken(e.target.value)} /></div>
          </div>
          <label className="label" style={{ marginTop: 10 }}>Access token</label>
          <input className="input" value={manualAccessToken} onChange={(e) => setManualAccessToken(e.target.value)} />
          <button className="btn secondary" type="button" style={{ marginTop: 10 }} disabled={busy} onClick={addManualAccount}>Add / Update Sender</button>
        </div> : null}

        <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Email</th><th>Status</th><th>Today</th><th>Last issue</th><th>Actions</th></tr></thead><tbody>
          {accounts.map((account) => <tr key={account.id}>
            <td><strong>{account.email}</strong></td>
            <td><span className={`status ${isPaused(account) ? 'paused' : account.status}`}>{isPaused(account) ? 'paused' : account.status}</span></td>
            <td>{Number(account.sent_today || 0).toLocaleString()}</td>
            <td className="muted">{account.last_error || (account.paused_until ? `Paused until ${new Date(account.paused_until).toLocaleString()}` : 'Ready')}</td>
            <td><button className="btn secondary" type="button" disabled={busy || !(account.access_token || account.refresh_token)} onClick={() => verifySenderProfile(account)}>Verify</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => pauseOrResume(account)}>{isPaused(account) || account.status !== 'connected' ? 'Resume' : 'Pause'}</button> <button className="btn secondary" type="button" disabled={busy} onClick={() => removeAccount(account)}>Remove</button></td>
          </tr>)}
          {!accounts.length ? <tr><td colSpan={5} className="muted">No senders connected yet.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Backend</h3>
        <label className="label">Backend URL</label>
        <input className="input" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={saveLocalBackend}>Save locally</button>
          <button className="btn secondary" onClick={checkBackend}>Check backend</button>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3>Extension API Key</h3>
        <input className="input" readOnly value={workspace.api_key || 'No API key found. Re-run migration.'} />
      </div>
    </div>
  );
}
