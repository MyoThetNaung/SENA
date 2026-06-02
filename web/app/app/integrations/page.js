'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';

export default function UserIntegrationsPage() {
  const [jiraConnected, setJiraConnected] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [briefingEnabled, setBriefingEnabled] = useState(true);
  const [briefingHour, setBriefingHour] = useState(8);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [integrations, prefs] = await Promise.all([
        apiFetch('/api/user/integrations').then((r) => r.json()),
        apiFetch('/api/user/assistant/preferences').then((r) => r.json()),
      ]);
      setJiraConnected(Boolean(integrations.jira));
      if (prefs.preferences) {
        setBriefingEnabled(prefs.preferences.briefingEnabled !== false);
        setBriefingHour(Number(prefs.preferences.briefingHour) || 8);
      }
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveJira = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const r = await apiFetch('/api/user/integrations/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, email, apiToken }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Save failed');
      setApiToken('');
      setMessage('Jira connected.');
      await load();
    } catch (err) {
      setMessage(err.message || String(err));
    }
  };

  const disconnectJira = async () => {
    setMessage('');
    const r = await apiFetch('/api/user/integrations/jira', { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Disconnect failed');
    setMessage('Jira disconnected.');
    await load();
  };

  const saveBriefing = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const r = await apiFetch('/api/user/assistant/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingEnabled, briefingHour }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Save failed');
      setMessage('Assistant preferences saved.');
    } catch (err) {
      setMessage(err.message || String(err));
    }
  };

  return (
    <PageSection title="Integrations & assistant" neuralBgId="neuralBgToggleIntegrations">
      {loading ? <p className="hint">Loading…</p> : null}

      <section style={{ marginBottom: '2.5rem', maxWidth: '640px' }}>
        <h3>Daily briefing (Telegram)</h3>
        <p className="hint">Morning digest of today&apos;s calendar and tasks, sent at your local hour.</p>
        <form onSubmit={saveBriefing} className="stack" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={briefingEnabled}
              onChange={(e) => setBriefingEnabled(e.target.checked)}
            />
            Enable daily briefing
          </label>
          <label>
            Local hour (0–23)
            <input
              type="number"
              min={0}
              max={23}
              value={briefingHour}
              onChange={(e) => setBriefingHour(Number(e.target.value))}
              style={{ width: '6rem' }}
            />
          </label>
          <button type="submit" className="btn primary">
            Save briefing settings
          </button>
        </form>
      </section>

      <section style={{ maxWidth: '640px' }}>
        <h3>Jira</h3>
        <p className="hint">
          Connect Jira so the assistant can search and create issues via chat tools.
          {jiraConnected ? ' Connected.' : ' Not connected.'}
        </p>
        <form onSubmit={saveJira} className="stack" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
          <label>
            Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-org.atlassian.net"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={{ width: '100%' }} />
          </label>
          <label>
            API token
            <input
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              type="password"
              placeholder={jiraConnected ? '•••••••• (leave blank to keep)' : ''}
              style={{ width: '100%' }}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn primary">
              {jiraConnected ? 'Update Jira' : 'Connect Jira'}
            </button>
            {jiraConnected ? (
              <button type="button" className="btn ghost" onClick={() => disconnectJira().catch((e) => setMessage(e.message))}>
                Disconnect
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {message ? <p className="hint" style={{ marginTop: '1rem' }}>{message}</p> : null}
    </PageSection>
  );
}
