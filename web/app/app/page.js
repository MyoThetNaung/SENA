'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function UserOverviewPage() {
  const [data, setData] = useState(null);
  const [clock, setClock] = useState('');
  const [tz, setTz] = useState('Asia/Rangoon');
  const [usageMonth, setUsageMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    apiFetch(`/api/user/overview?month=${encodeURIComponent(usageMonth)}`)
      .then((r) => r.json())
      .then((o) => {
        if (o.error) throw new Error(o.error);
        setData(o);
        setTz(o.timezone || 'Asia/Rangoon');
      })
      .catch(() => {});
  }, [usageMonth]);

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
    <PageSection title="Overview">
      <div className="overview-status-grid user-overview-grid">
        <div className="status-card">
          <div className="status-card-label">I am</div>
          <div className="status-card-value status-card-value-name">{data?.displayName || '…'}</div>
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
        <div className="status-card" style={{ gridColumn: '1 / -1' }}>
          <div className="status-card-label">Token usage (monthly)</div>
          <Label htmlFor="usage-month">Month</Label>
          <Input
            id="usage-month"
            type="month"
            value={usageMonth}
            onChange={(e) => setUsageMonth(e.target.value)}
            min="2000-01"
            max="2100-12"
            style={{ width: '130px', marginTop: '0.35rem' }}
          />
          {data?.tokenUsage ? (
            <div className="row" style={{ marginTop: '0.75rem', gap: '1.5rem' }}>
              <div>
                <div className="hint">Total tokens</div>
                <div className="status-card-value">{Number(data.tokenUsage.totalTokens || 0).toLocaleString()}</div>
              </div>
              <div>
                <div className="hint">Prompt</div>
                <div className="status-card-value" style={{ fontSize: '1rem' }}>
                  {Number(data.tokenUsage.promptTokens || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="hint">Completion</div>
                <div className="status-card-value" style={{ fontSize: '1rem' }}>
                  {Number(data.tokenUsage.completionTokens || 0).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: '0.75rem' }}>No usage recorded for this month yet.</p>
          )}
        </div>
      </div>
    </PageSection>
  );
}
