'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function UserCalendarPage() {
  const [events, setEvents] = useState([]);
  const [tz, setTz] = useState('Asia/Rangoon');
  const [status, setStatus] = useState('');

  async function load() {
    const [cal, overview] = await Promise.all([
      apiFetch('/api/user/calendar').then((r) => r.json()),
      apiFetch('/api/user/overview').then((r) => r.json()),
    ]);
    if (cal.error) throw new Error(cal.error);
    setEvents(cal.events || []);
    setTz(overview.timezone || 'Asia/Rangoon');
  }

  useEffect(() => {
    load().catch((e) => setStatus(e.message));
  }, []);

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', { timeZone: tz });
    } catch {
      return iso;
    }
  }

  async function remove(id) {
    if (!confirm('Delete this event?')) return;
    const r = await apiFetch(`/api/user/calendar/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
    await load();
  }

  return (
    <PageSection title="Calendar">
      <Card>
        <CardHeader><CardTitle>Your events</CardTitle></CardHeader>
        <CardContent>
          <div className="row" style={{ marginBottom: '0.75rem' }}><Button variant="outline" size="sm" onClick={() => load().catch((e) => setStatus(e.message))}>
            Refresh
          </Button></div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="hint">
                    No events yet.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>{formatWhen(ev.starts_at)}</TableCell>
                    <TableCell>{ev.title || '—'}</TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" onClick={() => remove(ev.id).catch((e) => setStatus(e.message))}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {status ? <p className="mt-3 text-sm hint">{status}</p> : null}
        </CardContent>
      </Card>
    </PageSection>
  );
}
