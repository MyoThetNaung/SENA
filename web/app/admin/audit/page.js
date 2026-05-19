'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function AdminAuditPage() {
  const [eventTypes, setEventTypes] = useState([]);
  const [eventType, setEventType] = useState('all');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const limit = 50;

  const load = useCallback(async () => {
    setStatus('Loading…');
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (eventType && eventType !== 'all') q.set('eventType', eventType);
    const r = await apiFetch(`/api/admin/audit?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load audit log');
    setRows(j.rows || []);
    setTotal(j.total ?? 0);
    setStatus('');
  }, [eventType, offset]);

  useEffect(() => {
    apiFetch('/api/admin/audit/event-types')
      .then((r) => r.json())
      .then((j) => setEventTypes(j.eventTypes || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load().catch((e) => setStatus(e.message));
  }, [load]);

  return (
    <PageSection title="Audit log">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="row">
            <Select
              value={eventType}
              onValueChange={(v) => {
                setEventType(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {eventTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => load().catch((e) => setStatus(e.message))}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="hint">
            {total} event{total === 1 ? '' : 's'}
            {eventType !== 'all' ? ` · filtered by ${eventType}` : ''}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    No audit entries yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatWhen(row.createdAt)}</TableCell>
                    <TableCell>
                      <code>
                        {row.eventType}
                      </code>
                    </TableCell>
                    <TableCell>
                      {row.actorRole || '—'}
                      {row.actorSoulUserId != null ? ` · user ${row.actorSoulUserId}` : ''}
                      {row.actorAdminId != null ? ` · admin ${row.actorAdminId}` : ''}
                    </TableCell>
                    <TableCell>
                      {row.httpMethod} {row.httpPath}
                    </TableCell>
                    <TableCell>{row.statusCode ?? '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
            <Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
              Previous
            </Button>
            <span className="hint">
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </Button>
          </div>
          {status ? <p className="hint">{status}</p> : null}
        </CardContent>
      </Card>
    </PageSection>
  );
}
