'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson, escapeHtml } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const WEB_BOT_KEY = 'web';

function botTabLabel(bot) {
  if (bot?.isWeb) return 'Web account';
  const un = bot?.username ? `@${String(bot.username).replace(/^@+/, '')}` : '';
  return un || `Bot ${bot?.botId ?? '?'}`;
}

function formatChatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function UserChatPage() {
  const [bots, setBots] = useState([{ isWeb: true, botId: null }]);
  const [currentBotKey, setCurrentBotKey] = useState(WEB_BOT_KEY);
  const [sessions, setSessions] = useState([]);
  const [sessionUserId, setSessionUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [limit, setLimit] = useState('100');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const bottomRef = useRef(null);

  const sessionsQ = useCallback(
    (botKey) =>
      botKey && botKey !== WEB_BOT_KEY
        ? `?botId=${encodeURIComponent(botKey)}`
        : '?botId=web',
    []
  );

  const loadBots = useCallback(async () => {
    const r = await apiJson('/api/user/chat/bots');
    const telegramBots = Array.isArray(r.bots) ? r.bots : [];
    setBots([{ isWeb: true, botId: null }, ...telegramBots]);
    return r.primaryUserId ?? null;
  }, []);

  const loadSessions = useCallback(
    async (botKey) => {
      const r = await apiJson(`/api/user/chat/sessions${sessionsQ(botKey)}`);
      const list = r.sessions || [];
      setSessions(list);
      return list;
    },
    [sessionsQ]
  );

  const loadMessages = useCallback(
    async (userId, botKey) => {
      if (userId == null || !Number.isFinite(Number(userId))) {
        setMessages([]);
        return;
      }
      const params = new URLSearchParams({ limit, userId: String(userId) });
      if (botKey && botKey !== WEB_BOT_KEY) params.set('botId', String(botKey));
      const data = await apiJson(`/api/user/chat?${params}`);
      setMessages((data.messages || []).filter((m) => String(m.role || '').toLowerCase() !== 'system'));
    },
    [limit]
  );

  const refresh = useCallback(
    async (targetUserId, botKey = currentBotKey) => {
      setStatus('');
      const list = await loadSessions(botKey);
      const pick =
        targetUserId != null && list.some((s) => s.userId === Number(targetUserId))
          ? Number(targetUserId)
          : list[0]?.userId ?? null;
      setSessionUserId(pick);
      if (pick != null) await loadMessages(pick, botKey);
      else setMessages([]);
    },
    [currentBotKey, loadMessages, loadSessions]
  );

  useEffect(() => {
    loadBots()
      .then(() => refresh(null, WEB_BOT_KEY))
      .catch((e) => setStatus(e.message));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function switchBot(botKey) {
    if (botKey === currentBotKey) return;
    setCurrentBotKey(botKey);
    refresh(null, botKey).catch((e) => setStatus(e.message));
  }

  function switchSession(nextId) {
    const n = Number(nextId);
    if (!Number.isFinite(n)) return;
    setSessionUserId(n);
    loadMessages(n, currentBotKey).catch((e) => setStatus(e.message));
  }

  async function send() {
    const text = input.trim();
    if (!text || sessionUserId == null) return;
    setInput('');
    setStatus('Sending…');
    try {
      await apiJson('/api/user/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, userId: sessionUserId }),
      });
      setStatus('');
      await loadMessages(sessionUserId, currentBotKey);
    } catch (e) {
      setStatus(e.message);
      setInput(text);
    }
  }

  async function clearChat() {
    if (sessionUserId == null) return;
    if (!confirm('Clear all messages for this session?')) return;
    try {
      await apiJson('/api/user/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: sessionUserId }),
      });
      await loadMessages(sessionUserId, currentBotKey);
      setStatus('Chat cleared.');
    } catch (e) {
      setStatus(e.message);
    }
  }

  const readOnlyTelegram = currentBotKey !== WEB_BOT_KEY;

  return (
    <PageSection title="Chat" neuralBgId="neuralBgToggleChat">
      <div className="toolbar mem-toolbar mem-toolbar-session" style={{ marginBottom: '1rem' }}>
        <div className="mem-toolbar-grid">
          <div className="mem-bot-select-wrap">
            <div className="session-select-row">
              <Label htmlFor="chatBotSelect">Bot</Label>
              <select
                id="chatBotSelect"
                className="sena-field chat-session-select"
                value={currentBotKey}
                onChange={(e) => switchBot(e.target.value)}
                aria-label="Select bot"
              >
                {bots.map((b) => {
                  const key = b.isWeb ? WEB_BOT_KEY : String(b.botId);
                  return (
                    <option key={key} value={key}>
                      {botTabLabel(b)}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="mem-bot-select-wrap">
            <div className="session-select-row">
              <Label htmlFor="chatSessionSelect">Session</Label>
              <select
                id="chatSessionSelect"
                className="sena-field chat-session-select"
                value={sessionUserId ?? ''}
                onChange={(e) => switchSession(e.target.value)}
              >
                {sessions.length === 0 ? (
                  <option value="">No sessions yet — chat on Telegram first</option>
                ) : (
                  sessions.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.label}
                      {s.lastAt ? ` · ${formatChatTime(s.lastAt)}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar row chat-toolbar">
          <label htmlFor="chatLimit">Messages</label>
          <select
            id="chatLimit"
            className="chat-session-select"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              if (sessionUserId != null) {
                loadMessages(sessionUserId, currentBotKey).catch((err) => setStatus(err.message));
              }
            }}
          >
            {['50', '100', '200', '500'].map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh(sessionUserId, currentBotKey).catch((e) => setStatus(e.message))}
          >
            Refresh
          </Button>
          <Button variant="destructive" size="sm" onClick={() => clearChat().catch((e) => setStatus(e.message))}>
            Clear session
          </Button>
        </div>
        {readOnlyTelegram ? (
          <p className="hint text-sm" style={{ marginBottom: '0.75rem' }}>
            Telegram bot chats are read-only here. Reply from Telegram, or switch to Web account to chat in the browser.
          </p>
        ) : null}
        <div className="chat-console">
          <div className="chat-messenger">
            <div className="chat-thread chat-messenger-thread">
              {messages.length === 0 ? (
                <p className="chat-empty hint">No messages in this session yet.</p>
              ) : (
                messages.map((m, i) => {
                  const isUser = String(m.role || '').toLowerCase() === 'user';
                  return (
                    <div
                      key={i}
                      className={isUser ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant'}
                    >
                      <span className="chat-meta">
                        {formatChatTime(m.created_at)} · {isUser ? 'User' : 'Assistant'}
                      </span>
                      <div
                        className="chat-text"
                        dangerouslySetInnerHTML={{
                          __html: escapeHtml(m.content || '').replace(/\n/g, '<br/>'),
                        }}
                      />
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
            {!readOnlyTelegram ? (
              <div className="chat-messenger-compose">
                <div className="chat-messenger-input-place">
                  <textarea
                    className="chat-messenger-input"
                    rows={2}
                    placeholder="Type a message…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="chat-messenger-send"
                    onClick={send}
                    disabled={!sessionUserId}
                    aria-label="Send message"
                  >
                    <svg
                      className="chat-messenger-send-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 512 512"
                      aria-hidden="true"
                    >
                      <path d="M481.508,210.336L68.414,38.926c-17.403-7.222-37.064-4.045-51.309,8.287C2.86,59.547-3.098,78.551,1.558,96.808 L38.327,241h180.026c8.284,0,15.001,6.716,15.001,15.001c0,8.284-6.716,15.001-15.001,15.001H38.327L1.558,415.193 c-4.656,18.258,1.301,37.262,15.547,49.595c14.274,12.357,33.937,15.495,51.31,8.287l413.094-171.409 C500.317,293.862,512,276.364,512,256.001C512,235.638,500.317,218.139,481.508,210.336z" />
                    </svg>
                    <span className="chat-messenger-send-label">Send</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {status ? <p className="hint" style={{ marginTop: '0.75rem' }}>{status}</p> : null}
      </div>
    </PageSection>
  );
}
