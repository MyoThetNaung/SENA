'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api.js';
import { useHydrated } from '../../lib/useHydrated.js';

export default function AdminLoginPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        if (me.authenticated && me.role === 'admin') {
          setLoggedIn(true);
        }
      });
  }, [router]);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setLoggedIn(false);
    router.refresh();
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
      window.location.href = '/admin.html';
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  const showLoggedIn = hydrated && loggedIn;

  return (
    <div className="auth-wrap card">
      <h1>SENA Admin</h1>
      <p className="auth-lead">Sign in with the administrator email and password.</p>
      {showLoggedIn ? (
        <div style={{ marginBottom: '1rem' }}>
          <p className="auth-lead">You are already signed in as admin.</p>
          <button type="button" className="btn primary" onClick={() => (window.location.href = '/admin.html')}>
            Open control panel
          </button>
          <button type="button" className="btn" style={{ marginLeft: '0.5rem' }} onClick={logout}>
            Sign out
          </button>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className={showLoggedIn ? 'hidden' : undefined}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="btn primary" style={{ marginTop: '1rem' }}>
          Sign in
        </button>
      </form>
      <p className="auth-error">{error}</p>
      <div className="auth-links">
        <Link href="/login">User sign in (GOOGLE LOGIN)</Link>
      </div>
    </div>
  );
}
