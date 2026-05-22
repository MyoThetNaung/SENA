'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const USER_EVENT_LABELS = {
  'auth.google_login': 'Signed in with Google',
  'auth.logout': 'Signed out',
  'user.profile_update': 'Updated profile',
  'user.memory_update': 'Updated memory',
  'user.chat_send': 'Sent chat message',
  'user.chat_clear': 'Cleared chat',
  'user.calendar_delete': 'Deleted calendar event',
  'api.request': 'API action',
};

function formatLogTime(iso, timeZone) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: timeZone || undefined,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function formatActivityLine(row, timeZone) {
  const label = USER_EVENT_LABELS[row.eventType] || row.eventType || 'Activity';
  const status = row.statusCode != null ? ` · ${row.statusCode}` : '';
  const path = row.httpPath ? ` · ${row.httpPath}` : '';
  return `${formatLogTime(row.createdAt, timeZone)}  ${label}${status}${path}`;
}

export default function UserOverviewPage() {
  const [data, setData] = useState(null);
  const [clock, setClock] = useState('');
  const [tz, setTz] = useState('Asia/Rangoon');
  const [activityLog, setActivityLog] = useState('');
  const [usageMonth, setUsageMonth] = useState('');

  useEffect(() => {
    const d = new Date();
    setUsageMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }, []);

  const loadActivityLog = useCallback(async (timeZone) => {
    const r = await apiFetch('/api/user/activity-log?limit=80');
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Could not load activity log');
    const lines = (j.rows || []).map((row) => formatActivityLine(row, timeZone));
    setActivityLog(lines.length ? lines.join('\n') : 'No activity recorded yet.');
  }, []);

  useEffect(() => {
    if (!usageMonth) return;
    apiFetch(`/api/user/overview?month=${encodeURIComponent(usageMonth)}`)
      .then((r) => r.json())
      .then((o) => {
        if (o.error) throw new Error(o.error);
        setData(o);
        const nextTz = o.timezone || 'Asia/Rangoon';
        setTz(nextTz);
        return loadActivityLog(nextTz);
      })
      .catch(() => {});
  }, [usageMonth, loadActivityLog]);

  useEffect(() => {
    const tick = () => {
      try {
        setClock(
          new Date().toLocaleString('en-US', {
            timeZone: tz,
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          })
        );
      } catch {
        setClock(new Date().toLocaleString());
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tz]);

  const running = Boolean(data?.bot?.running);

  return (
    <PageSection title="Overview" neuralBgId="neuralBgToggleOverview">
      <div className="user-overview-layout">
        <div className="user-overview-top-row">
          <div className="status-card">
            <div className="status-card-label">I am</div>
            <div
              className="status-card-value status-card-value-name"
              title={data?.displayName || undefined}
            >
              {data?.displayName || '…'}
            </div>
          </div>
          <div className="status-card" id="overviewCardTelegram">
            <div className="status-card-head">
              <span className="status-card-label">AI assistance</span>
              <span className={`status-led${running ? ' is-live' : ' is-idle'}`} aria-hidden="true" />
            </div>
            <div className="status-card-value">{running ? 'Running' : 'Stopped'}</div>
            <div className="status-card-sub">{data?.telegramLine || '…'}</div>
          </div>
          <div className="status-card" id="overviewCardClock">
            <div className="status-card-label">Panel time</div>
            <div className="status-card-value overview-clock-line">{clock || '…'}</div>
            <div className="status-card-sub">{tz}</div>
          </div>
        </div>

        <div className="status-card user-overview-token-card">
          <div className="status-card-label">Token usage (monthly)</div>
          <div className="user-overview-token-toolbar">
            <Label htmlFor="usage-month">Month</Label>
            <Input
              id="usage-month"
              type="month"
              value={usageMonth}
              onChange={(e) => setUsageMonth(e.target.value)}
              min="2000-01"
              max="2100-12"
              suppressHydrationWarning
            />
          </div>
          {data?.tokenUsage ? (
            <div className="user-overview-token-stats">
              <div>
                <div className="hint">Total tokens</div>
                <div className="status-card-value">
                  {Number(data.tokenUsage.totalTokens || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="hint">Prompt</div>
                <div className="status-card-value user-overview-token-stat-sm">
                  {Number(data.tokenUsage.promptTokens || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="hint">Completion</div>
                <div className="status-card-value user-overview-token-stat-sm">
                  {Number(data.tokenUsage.completionTokens || 0).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <p className="hint user-overview-token-empty">No usage recorded for this month yet.</p>
          )}
        </div>

        <div className="status-card user-overview-log-card">
          <div className="status-card-head">
            <span className="status-card-label">User log</span>
            <button
              type="button"
              className="btn-mini ghost"
              onClick={() => loadActivityLog(tz).catch(() => setActivityLog('Could not refresh log.'))}
            >
              Refresh
            </button>
          </div>
          <pre className="log user-overview-log" aria-live="polite">
            {activityLog || 'Loading…'}
          </pre>
        </div>
      </div>
    </PageSection>
  );
}
