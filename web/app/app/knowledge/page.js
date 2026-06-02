'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';

export default function UserKnowledgePage() {
  const [status, setStatus] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [st, docs] = await Promise.all([
        apiFetch('/api/user/knowledge/status').then((r) => r.json()),
        apiFetch('/api/user/knowledge/documents').then((r) => r.json()),
      ]);
      if (st.error) throw new Error(st.error);
      setStatus(st);
      setDocuments(Array.isArray(docs.documents) ? docs.documents : []);
    } catch (e) {
      setMessage(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const r = await apiFetch('/api/user/knowledge/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentTitle: title.trim() || 'Untitled',
          content: content.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed');
      setTitle('');
      setContent('');
      setMessage(`Uploaded (${j.chunkCount || 0} chunks indexed).`);
      await load();
    } catch (err) {
      setMessage(err.message || String(err));
    }
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setMessage('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || '');
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const r = await apiFetch('/api/user/knowledge/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileBase64: b64 }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed');
        setMessage(`Uploaded ${file.name} (${j.chunkCount || 0} chunks).`);
        await load();
      } catch (err) {
        setMessage(err.message || String(err));
      }
    };
    reader.readAsDataURL(file);
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this document from your personal knowledge?')) return;
    setMessage('');
    try {
      const r = await apiFetch(`/api/user/knowledge/documents/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Delete failed');
      await load();
    } catch (err) {
      setMessage(err.message || String(err));
    }
  };

  const ragReady = status?.ragEnabled && status?.embeddingsConfigured;

  return (
    <PageSection title="Personal knowledge" neuralBgId="neuralBgToggleKnowledge">
      {loading ? <p className="hint">Loading…</p> : null}
      {!loading && status && !status.ragEnabled ? (
        <p className="hint">Knowledge search is disabled by your administrator.</p>
      ) : null}
      {!loading && status?.ragEnabled && !status.embeddingsConfigured ? (
        <p className="hint">Embeddings are not configured yet. Ask an admin to set up RAG.</p>
      ) : null}

      {ragReady ? (
        <>
          <p className="hint" style={{ marginBottom: '1rem' }}>
            Upload notes or documents for your personal assistant. Only you can search these via chat
            (search_knowledge tool).
          </p>
          <form onSubmit={upload} className="stack" style={{ gap: '0.75rem', maxWidth: '640px' }}>
            <label>
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Meeting notes"
                style={{ width: '100%' }}
              />
            </label>
            <label>
              Or upload a text file (.txt, .md, .json, .csv)
              <input
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,.log"
                onChange={(e) => uploadFile(e.target.files?.[0])}
              />
            </label>
            <label>
              Content
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                placeholder="Paste text or markdown…"
                style={{ width: '100%' }}
              />
            </label>
            <button type="submit" className="btn primary">
              Upload &amp; index
            </button>
          </form>

          <h3 style={{ marginTop: '2rem' }}>Your documents ({documents.length})</h3>
          {documents.length === 0 ? (
            <p className="hint">No personal documents yet.</p>
          ) : (
            <ul className="stack" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
              {documents.map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <span>
                    <strong>{d.title}</strong>
                    <span className="hint" style={{ marginLeft: '0.5rem' }}>
                      {d.chunk_count} chunks · updated{' '}
                      {d.updated_at ? new Date(d.updated_at).toLocaleString() : '—'}
                    </span>
                  </span>
                  <button type="button" className="btn ghost" onClick={() => remove(d.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {message ? <p className="hint" style={{ marginTop: '1rem' }}>{message}</p> : null}
    </PageSection>
  );
}
