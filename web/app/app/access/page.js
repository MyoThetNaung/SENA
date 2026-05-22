'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatBotLabel(u) {
  const un = u?.botUsername ? `@${u.botUsername}` : '';
  return un ? `${un} (${u.botId})` : `Bot ${u?.botId ?? '?'}`;
}

function formatUser(u) {
  if (u.username) return `@${u.username}`;
  if (u.firstName) return u.firstName;
  if (u.telegramUserId) return `id ${u.telegramUserId}`;
  return String(u.scopedUserId || '—');
}

export default function UserAccessPage() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await apiFetch('/api/user/access').then((r) => r.json());
      if (a.error) throw new Error(a.error);
      setUsers(Array.isArray(a.users) ? a.users : []);
      setStatus('');
    } catch (e) {
      setUsers([]);
      setStatus(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateAccess(id, nextStatus) {
    setStatus('Updating…');
    try {
      const r = await apiFetch(`/api/user/access/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed');
      setStatus(nextStatus === 'approved' ? 'User approved.' : 'User blocked.');
      await load();
    } catch (e) {
      setStatus(e.message);
    }
  }

  const pending = users.filter((u) => u.status === 'pending');
  const approved = users.filter((u) => u.status === 'approved');
  const blocked = users.filter((u) => u.status === 'blocked');

  return (
    <PageSection title="Access" neuralBgId="neuralBgToggleAccess">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Who can use your bot</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="hint text-sm">
            Approve or block people who message your Telegram bot. You only see requests for bots you connected.
          </p>

          <section>
            <h3 className="text-sm font-semibold mb-2">Pending approval</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>First message</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="hint">
                      No pending requests.
                    </TableCell>
                  </TableRow>
                ) : (
                  pending.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{formatBotLabel(u)}</TableCell>
                      <TableCell>{formatUser(u)}</TableCell>
                      <TableCell className="max-w-xs truncate">{u.firstMessagePreview || '—'}</TableCell>
                      <TableCell className="nowrap">{u.createdAt || ''}</TableCell>
                      <TableCell className="nowrap">
                        <Button type="button" size="sm" onClick={() => updateAccess(u.id, 'approved')}>
                          Approve
                        </Button>{' '}
                        <Button type="button" variant="destructive" size="sm" onClick={() => updateAccess(u.id, 'blocked')}>
                          Block
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Approved</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {approved.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="hint">
                      No approved users yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  approved.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{formatBotLabel(u)}</TableCell>
                      <TableCell>{formatUser(u)}</TableCell>
                      <TableCell>{u.lastSeen || ''}</TableCell>
                      <TableCell>
                        <Button type="button" variant="destructive" size="sm" onClick={() => updateAccess(u.id, 'blocked')}>
                          Block
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Blocked</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocked.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="hint">
                      None blocked.
                    </TableCell>
                  </TableRow>
                ) : (
                  blocked.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{formatBotLabel(u)}</TableCell>
                      <TableCell>{formatUser(u)}</TableCell>
                      <TableCell>
                        <Button type="button" size="sm" onClick={() => updateAccess(u.id, 'approved')}>
                          Approve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </CardContent>
      </Card>
    </PageSection>
  );
}
