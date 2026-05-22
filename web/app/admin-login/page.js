'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api.js';
import { AuthLayout } from '@/components/auth-layout';

export default function AdminLoginPage() {
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        if (cancelled) return;
        if (me.authenticated && me.role === 'admin') {
          setLoggedIn(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setLoggedIn(false);
    setSessionChecked(true);
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    setError('');
    try {
      const r = await apiFetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Login failed');
      window.location.href = '/admin';
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  return (
    <AuthLayout title="SENA Admin" description="Sign in with the administrator email and password.">
      {sessionChecked && loggedIn ? (
        <div className="space-y-4 text-center">
          <p className="hint">You are already signed in as admin.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button className="primary" type="button" onClick={() => (window.location.href = '/admin')}>
              Open control panel
            </button>
            <button className="primary ghost" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={onSubmit} className="flex flex-col gap-5" suppressHydrationWarning>
            <div className="space-y-2">
              <label htmlFor="email" className="text-slate-200">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                suppressHydrationWarning
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-slate-200">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                suppressHydrationWarning
              />
            </div>
            <button type="submit" className="primary mt-2">
              Sign in
            </button>
          </form>
          {error ? <p className="auth-error">{error}</p> : null}
          <p className="auth-links !mt-0 text-center">
            <Link href="/login">User sign in (Google)</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
