'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

type Mode = 'login' | 'signup' | 'forgot';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => searchParams.get('next') || '/dashboard', [searchParams]);
  const [mode, setMode] = useState<Mode>('login');
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

    try {
      if (mode === 'forgot') {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${origin}/auth/callback?next=/reset-password`
        });
        if (resetError) {
          setError(resetError.message || 'Password reset failed.');
          return;
        }
        setMessage('Password reset email sent. Check your inbox, then follow the link to create a new password.');
        return;
      }

      if (mode === 'login') {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (loginError) {
          setError(loginError.message || 'Sign in failed.');
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback?next=/dashboard` : undefined
        }
      });
      if (signupError) {
        setError(signupError.message || 'Account creation failed.');
        return;
      }

      if (data.session) {
        setMessage('Account created. Preparing your private Scout workspace...');
        router.replace(next);
        router.refresh();
        return;
      }

      setMessage('Account created. Check your email to confirm your account, then sign in.');
      setMode('login');
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  const title = mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password';
  const subtitle = mode === 'forgot'
    ? 'Enter your email. Scout will send a reset link so you can create a new password.'
    : 'Email + password login. Every user gets a private Scout workspace.';

  return (
    <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <section className="card" style={{ width: '100%', maxWidth: 460, padding: 28 }}>
        <div className="brand" style={{ marginBottom: 24 }}>
          <div className="logo" />
          <div>
            <h1>Scout App</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          {mode !== 'forgot' ? (
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
          ) : null}
          {error && <div className="error">{error}</div>}
          {message && <div className="success">{message}</div>}
          <button className="btn" disabled={loading}>{loading ? 'Please wait...' : title}</button>
        </form>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn secondary" type="button" onClick={() => { setError(null); setMessage(null); setMode(mode === 'signup' || mode === 'forgot' ? 'login' : 'signup'); }}>
            {mode === 'login' ? 'Create new account' : 'Back to sign in'}
          </button>
          {mode === 'login' ? (
            <button className="btn secondary" type="button" onClick={() => { setError(null); setMessage(null); setMode('forgot'); }}>
              Forgot password?
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
