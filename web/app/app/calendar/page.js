'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { MonthCalendar } from '@/components/month-calendar';

export default function UserCalendarPage() {
  const [events, setEvents] = useState([]);
  const [tz, setTz] = useState('Asia/Rangoon');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setStatus('');
    try {
      const [cal, overview] = await Promise.all([
        apiFetch('/api/user/calendar').then((r) => r.json()),
        apiFetch('/api/user/overview').then((r) => r.json()),
      ]);
      if (cal.error) throw new Error(cal.error);
      setEvents(Array.isArray(cal.events) ? cal.events : []);
      setTz(overview.timezone || 'Asia/Rangoon');
    } catch (e) {
      setStatus(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = useCallback(
    async (id) => {
      const r = await apiFetch(`/api/user/calendar/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
      await load();
    },
    [load]
  );

  return (
    <PageSection title="Calendar" neuralBgId="neuralBgToggleCalendar">
      <MonthCalendar
        events={events}
        loading={loading}
        timeZone={tz}
        onRefresh={load}
        onDelete={remove}
      />
      {status ? <p className="hint" style={{ marginTop: '0.75rem' }}>{status}</p> : null}
    </PageSection>
  );
}
