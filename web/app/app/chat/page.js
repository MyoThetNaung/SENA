'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function UserChatPage() {
  const [messages, setMessages] = useState([]);
  const [limit, setLimit] = useState('100');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const bottomRef = useRef(null);

  async function load() {
    const data = await apiFetch(`/api/user/chat?limit=${encodeURIComponent(limit)}`).then((r) => r.json());
    if (data.error) throw new Error(data.error);
    setMessages((data.messages || []).filter((m) => String(m.role || '').toLowerCase() !== 'system'));
  }

  useEffect(() => {
    load().catch((e) => setStatus(e.message));
  }, [limit]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setStatus('Sending…');
    const r = await apiFetch('/api/user/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Send failed');
    setStatus('');
    await load();
  }

  async function clearChat() {
    if (!confirm('Clear all your chat messages?')) return;
    const r = await apiFetch('/api/user/chat/clear', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Clear failed');
    await load();
  }

  return (
    <PageSection title="Chat">
      <div className="card">
        <div className="toolbar row chat-toolbar">
          <label htmlFor="chatLimit">Messages</label>
          <select id="chatLimit" className="chat-session-select" value={limit} onChange={(e) => setLimit(e.target.value)}>
            {['50', '100', '200', '500'].map((n) => (
              <option key={n} value={n}>Last {n}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => load().catch((e) => setStatus(e.message))}>Refresh</Button>
          <Button variant="destructive" size="sm" onClick={() => clearChat().catch((e) => setStatus(e.message))}>Clear</Button>
        </div>
        <div className="chat-console">
          <div className="chat-messenger">
            <div className="chat-thread chat-messenger-thread">
              {messages.length === 0 ? (
                <p className="chat-empty hint">No messages yet.</p>
              ) : (
                messages.map((m, i) => {
                  const isUser = String(m.role || '').toLowerCase() === 'user';
                  return (
                    <div
                      key={i}
                      className={isUser ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant'}
                    >
                      <span className="chat-meta">{isUser ? 'You' : 'Assistant'}</span>
                      <span className="chat-text">{m.content || ''}</span>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
            <div className="chat-messenger-compose">
              <div className="chat-messenger-input-place">
                <Textarea
                  className="chat-messenger-input"
                  placeholder="Type a message…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send().catch((err) => setStatus(err.message));
                    }
                  }}
                  rows={2}
                />
                <Button onClick={() => send().catch((e) => setStatus(e.message))}>Send</Button>
              </div>
            </div>
          </div>
        </div>
        {status ? <p className="hint">{status}</p> : null}
      </div>
    </PageSection>
  );
}
