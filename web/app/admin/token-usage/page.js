'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatNum(n) {
  return Number(n || 0).toLocaleString();
}

function userLabel(u) {
  if (u.displayName) return u.displayName;
  if (u.email) return u.email;
  if (u.username) return `@${u.username}`;
  return `User ${u.soulUserId}`;
}

export default function AdminTokenUsagePage() {
  const [month, setMonth] = useState(currentMonth());
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState('');

  const loadAll = useCallback(async () => {
    setStatus('Loading…');
    const r = await apiFetch(`/api/admin/token-usage?month=${encodeURIComponent(month)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load');
    setUsers(j.users || []);
    setStatus('');
  }, [month]);

  const loadUser = useCallback(
    async (soulUserId) => {
      setSelected(soulUserId);
      setStatus('Loading user…');
      const r = await apiFetch(
        `/api/admin/token-usage?month=${encodeURIComponent(month)}&soulUserId=${encodeURIComponent(soulUserId)}`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load user');
      setDetail(j);
      setStatus('');
    },
    [month]
  );

  useEffect(() => {
    loadAll().catch((e) => setStatus(e.message));
    setSelected(null);
    setDetail(null);
  }, [loadAll]);

  return (
    <PageSection title="Token usage">
      <Card >
        <CardHeader>
          <CardTitle>Monthly usage by user</CardTitle>
        </CardHeader>
        <CardContent >
          <div className="row">
            <div >
              <Label htmlFor="month">Month (YYYY-MM)</Label>
              <Input
                id="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="2026-05"
                style={{ width: '140px' }}
              />
            </div>
            <Button onClick={() => loadAll().catch((e) => setStatus(e.message))}>Apply</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Prompt</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="hint">
                    No token usage recorded for this month.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.soulUserId} >
                    <TableCell>{userLabel(u)}</TableCell>
                    <TableCell >{formatNum(u.promptTokens)}</TableCell>
                    <TableCell >{formatNum(u.completionTokens)}</TableCell>
                    <TableCell >{formatNum(u.totalTokens)}</TableCell>
                    <TableCell >{u.requestCount}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => loadUser(u.soulUserId).catch((e) => setStatus(e.message))}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {detail ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {month} · User {detail.soulUserId}
            </CardTitle>
          </CardHeader>
          <CardContent className="row" style={{ gap: '1.5rem' }}>
            <div>
              <p className="text-xs hint">Prompt tokens</p>
              <p className="status-card-value">{formatNum(detail.promptTokens)}</p>
            </div>
            <div>
              <p className="text-xs hint">Completion tokens</p>
              <p className="status-card-value">{formatNum(detail.completionTokens)}</p>
            </div>
            <div>
              <p className="text-xs hint">Total</p>
              <p className="status-card-value">{formatNum(detail.totalTokens)}</p>
            </div>
            <div>
              <p className="text-xs hint">LLM requests</p>
              <p className="status-card-value">{detail.requestCount}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {status ? <p className="mt-3 text-sm hint">{status}</p> : null}
    </PageSection>
  );
}
