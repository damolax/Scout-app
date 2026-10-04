'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type Account = {
  id: string;
  email: string;
  display_name?: string | null;
  status?: string | null;
  auth_mode?: string | null;
  smtp_verified_at?: string | null;
  sent_today?: number | null;
  daily_limit?: number | null;
  last_error?: string | null;
};

export default function SendingAccountsClient({ workspaceId }: { workspaceId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/senders/smtp?workspace_id=' + encodeURIComponent(workspaceId), { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Could not load sending accounts.');
    setAccounts(json.accounts || []);
  }, [workspaceId]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy('connect'); setError(''); setNotice('');
    try {
      const response = await fetch('/api/senders/smtp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action: 'connect', email, display_name: displayName, app_password: appPassword }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not connect this Gmail account.');
      setEmail(''); setDisplayName(''); setAppPassword('');
      setNotice('Gmail sender connected and verified through SMTP.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  }

  async function action(accountId: string, next: 'test' | 'disconnect') {
    setBusy(accountId + next); setError(''); setNotice('');
    try {
      const response = await fetch('/api/senders/smtp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action: next, account_id: accountId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Action failed.');
      setNotice(next === 'test' ? 'Connection test passed.' : 'Sender disconnected.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  }

  return (
    <>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Add Gmail sender</h3>
        <form onSubmit={connect} className="stack">
          <div className="grid two">
            <label>
              <span>Gmail address</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" required />
            </label>
            <label>
              <span>Sender name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Optional display name" />
            </label>
          </div>
          <label>
            <span>Google App Password</span>
            <input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="16-character App Password" autoComplete="new-password" required />
          </label>
          <div className="muted">Use the App Password generated in your Google Account after enabling 2-Step Verification, not your normal Gmail password.</div>
          <div className="actions">
            <button className="btn" disabled={busy === 'connect'}>{busy === 'connect' ? 'Testing and connecting…' : 'Connect sender'}</button>
          </div>
        </form>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Connected senders</h3>
        {!accounts.length ? <p className="muted">No sending accounts connected yet.</p> :
          <div className="stack">
            {accounts.map((account) => (
              <div className="card" key={account.id} style={{ padding: 14 }}>
                <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{account.email}</strong>
                    <div className="muted">
                      {account.auth_mode === 'smtp' ? 'Gmail App Password · SMTP' : 'Legacy Google OAuth'}
                      {' · '}{account.status || 'unknown'}
                      {account.smtp_verified_at ? ' · verified' : ''}
                    </div>
                  </div>
                  <div className="actions">
                    {account.auth_mode === 'smtp' && <button className="btn secondary" type="button" disabled={busy === account.id + 'test'} onClick={() => action(account.id, 'test')}>Test</button>}
                    {account.auth_mode === 'smtp' && <button className="btn secondary" type="button" disabled={busy === account.id + 'disconnect'} onClick={() => action(account.id, 'disconnect')}>Disconnect</button>}
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>Sent today: {account.sent_today || 0}{account.daily_limit ? ' / ' + account.daily_limit : ''}</div>
                {account.last_error && <div className="error" style={{ marginTop: 8 }}>{account.last_error}</div>}
              </div>
            ))}
          </div>}
      </div>
    </>
  );
}
