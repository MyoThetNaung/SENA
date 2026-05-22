'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailList } from '@/components/detail-list';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

function formatBotLabel(bot) {
  const un = bot?.botUsername ? `@${bot.botUsername}` : '';
  return un ? `${un} (${bot.botId})` : `Bot ${bot?.botId ?? '?'}`;
}

export default function UserTelegramPage() {
  const [linkItems, setLinkItems] = useState([]);
  const [bots, setBots] = useState([]);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await apiFetch('/api/user/telegram').then((r) => r.json());
      if (t.error) throw new Error(t.error);
      setLinkItems(
        t.linked
          ? [
              ['Username', t.username ? `@${t.username}` : '—'],
              ['Telegram user id', t.telegramUserId ?? '—'],
              ['Email', t.email || '—'],
              ['Account status', t.status || '—'],
              ['Last seen', t.lastSeen || '—'],
            ]
          : [['Status', 'Not linked to Telegram yet']]
      );
      setBots(Array.isArray(t.bots) ? t.bots : []);
      setErr(false);
    } catch {
      setLinkItems([['Status', 'Failed to load']]);
      setBots([]);
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveToken() {
    const tok = token.trim();
    if (!tok) {
      setStatus('Paste a bot token first.');
      setErr(true);
      return;
    }
    setStatus('Connecting…');
    setErr(false);
    try {
      const r = await apiFetch('/api/user/telegram/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setToken('');
      setStatus('Bot connected.');
      await load();
    } catch (e) {
      setStatus(e.message);
      setErr(true);
    }
  }

  async function removeBot(botId) {
    if (!window.confirm('Disconnect this bot?')) return;
    setStatus('Removing…');
    try {
      const r = await apiFetch(`/api/user/telegram/bots/${botId}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Remove failed');
      setStatus('Bot removed.');
      await load();
    } catch (e) {
      setStatus(e.message);
      setErr(true);
    }
  }

  return (
    <PageSection title="Telegram" neuralBgId="neuralBgToggleTelegram">
      <Card>
        <CardHeader>
          <CardTitle>Your Telegram bot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="hint text-sm">
            Connect a bot token from @BotFather. Only your account can see or manage your bots.
          </p>
          <div>
            <h3 className="text-sm font-medium mb-2">Linked account</h3>
            <DetailList items={linkItems} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="userBotToken">Bot token</Label>
            <div className="flex gap-2 flex-wrap">
              <Input
                id="userBotToken"
                type="password"
                autoComplete="off"
                placeholder="Paste token from @BotFather"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveToken();
                }}
                className="max-w-md flex-1"
              />
              <Button type="button" onClick={saveToken} disabled={loading}>
                Connect
              </Button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Connected bots</h3>
            {bots.length === 0 ? (
              <p className="hint text-sm">No bots connected yet.</p>
            ) : (
              <ul className="space-y-2">
                {bots.map((b) => (
                  <li
                    key={b.botId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                  >
                    <span>
                      {formatBotLabel(b)} — {b.tokenMasked}
                    </span>
                    <Button type="button" variant="destructive" size="sm" onClick={() => removeBot(b.botId)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {status ? (
            <p className={`text-sm ${err ? 'text-destructive' : 'text-muted-foreground'}`}>{status}</p>
          ) : null}
        </CardContent>
      </Card>
    </PageSection>
  );
}
