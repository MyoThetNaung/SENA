'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';

export default function UserTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState('normal');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const r = await apiFetch(`/api/user/tasks?status=${encodeURIComponent(statusFilter)}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'Load failed');
      setTasks(Array.isArray(j.tasks) ? j.tasks : []);
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const addTask = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const body = {
        title: title.trim(),
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
      };
      const r = await apiFetch('/api/user/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Add failed');
      setTitle('');
      setDueAt('');
      await load();
    } catch (err) {
      setMessage(err.message || String(err));
    }
  };

  const complete = async (id) => {
    const r = await apiFetch(`/api/user/tasks/${id}/complete`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Complete failed');
    await load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this task?')) return;
    const r = await apiFetch(`/api/user/tasks/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
    await load();
  };

  return (
    <PageSection title="Tasks" neuralBgId="neuralBgToggleTasks">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {['open', 'done', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            className={statusFilter === s ? 'btn primary' : 'btn ghost'}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={addTask} className="stack" style={{ gap: '0.75rem', maxWidth: '640px', marginBottom: '2rem' }}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <label>
          Due
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
        <button type="submit" className="btn primary">
          Add task
        </button>
      </form>

      {loading ? <p className="hint">Loading…</p> : null}
      {!loading && tasks.length === 0 ? <p className="hint">No tasks.</p> : null}
      <ul className="stack" style={{ gap: '0.5rem' }}>
        {tasks.map((t) => (
          <li
            key={t.id}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}
          >
            <span>
              <strong>#{t.id}</strong> {t.title}
              <span className="hint" style={{ marginLeft: '0.5rem' }}>
                [{t.status}] {t.due_at ? new Date(t.due_at).toLocaleString() : 'no due date'}
              </span>
            </span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              {t.status === 'open' ? (
                <button type="button" className="btn ghost" onClick={() => complete(t.id).catch((e) => setMessage(e.message))}>
                  Done
                </button>
              ) : null}
              <button type="button" className="btn ghost" onClick={() => remove(t.id).catch((e) => setMessage(e.message))}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {message ? <p className="hint" style={{ marginTop: '1rem' }}>{message}</p> : null}
    </PageSection>
  );
}
