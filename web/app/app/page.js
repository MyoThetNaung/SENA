'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiFetch, escapeHtml } from '../../lib/api.js';

export default function UserAppPage() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const logRef = useRef(null);

  async function loadChat() {
    const data = await apiFetch('/api/user/chat?limit=100').then((r) => r.json());
    if (data.error) throw new Error(data.error);
    setMessages(data.messages || []);
  }

  useEffect(() => {
    (async () => {
      const me = await apiFetch('/api/auth/me').then((r) => r.json());
      if (!me.authenticated || me.role !== 'user') {
        window.location.href = '/login';
        return;
      }
      try {
        await loadChat();
      } catch (e) {
        setError(e.message || String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  async function send(ev) {
    ev.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setError('');
    setText('');
    try {
      const r = await apiFetch('/api/user/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Send failed');
      await loadChat();
    } catch (e) {
      setError(e.message || String(e));
      setText(msg);
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="user-chat-wrap card">
      <h1>SENA</h1>
      <p className="auth-lead">Your conversation</p>
      <div className="user-chat-log" ref={logRef}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`user-chat-row ${m.role === 'user' ? 'user' : 'assistant'}`}
          >
            <span className="chat-role">{m.role === 'user' ? 'You' : 'SENA'}</span>
            <div
              className="chat-text"
              dangerouslySetInnerHTML={{ __html: escapeHtml(m.content || '') }}
            />
          </div>
        ))}
      </div>
      <form className="user-chat-form" onSubmit={send}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          autoComplete="off"
          disabled={sending}
        />
        <button type="submit" className="btn primary" disabled={sending}>
          Send
        </button>
      </form>
      <p className="auth-error">{error}</p>
      <div className="auth-links">
        <button type="button" className="btn" onClick={logout}>
          Sign out
        </button>
        {' · '}
        <Link href="/login">Back</Link>
      </div>
    </div>
  );
}
