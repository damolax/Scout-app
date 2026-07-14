'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function ResetPasswordClient() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || 'Could not update password. Open the latest reset link from your email and try again.');
      return;
    }

    setMessage('Password updated. You can now sign in with your new password.');
    setTimeout(() => {
      router.replace('/login');
      router.refresh();
    }, 1200);
  }

  return (
    <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <section className="card" style={{ width: '100%', maxWidth: 460, padding: 28 }}>
        <div className="brand" style={{ marginBottom: 24 }}>
          <div className="logo" />
          <div>
            <h1>Create new password</h1>
            <p>Enter and confirm your new Scout password.</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" />
          </div>
          {error ? <div className="error">{error}</div> : null}
          {message ? <div className="success">{message}</div> : null}
          <button className="btn" disabled={loading}>{loading ? 'Saving...' : 'Save new password'}</button>
        </form>
      </section>
    </main>
  );
}
