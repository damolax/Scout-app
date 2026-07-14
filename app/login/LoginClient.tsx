'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => searchParams.get('next') || '/dashboard', [searchParams]);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();

    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === 'signup') {
      setMessage('Account created. If email confirmation is disabled, you are signed in now. If Supabase requires confirmation, check your email once.');
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <section className="card" style={{ width: '100%', maxWidth: 460, padding: 28 }}>
        <div className="brand" style={{ marginBottom: 24 }}>
          <div className="logo" />
          <div>
            <h1>Scout App</h1>
            <p>Email + password login. Every user gets a private Scout workspace.</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
          {error && <div className="error">{error}</div>}
          {message && <div className="success">{message}</div>}
          <button className="btn" disabled={loading}>{loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn secondary" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Create new account' : 'Back to sign in'}
          </button>
        </div>
      </section>
    </main>
  );
}
