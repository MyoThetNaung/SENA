'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api.js';
import { PageSection } from '@/components/page-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function AdminKnowledgePage() {
  const [status, setStatus] = useState('');
  const [ragStatus, setRagStatus] = useState(null);
  const [sources, setSources] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [settings, setSettings] = useState({
    ragEnabled: true,
    ragAutoInject: false,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
    ragTopK: 8,
    ragMinScore: 0.25,
  });
  const [ingest, setIngest] = useState({
    sourceSlug: 'company-wiki',
    sourceTitle: 'Company Wiki',
    sourceType: 'wiki',
    documentTitle: '',
    externalId: '',
    uri: '',
    content: '',
    aclMode: 'public',
    aclUserIds: '',
  });

  const load = useCallback(async () => {
    setStatus('Loading…');
    const [st, src, docs, cfg] = await Promise.all([
      apiFetch('/api/knowledge/status').then((r) => r.json()),
      apiFetch('/api/knowledge/sources').then((r) => r.json()),
      apiFetch('/api/knowledge/documents?limit=200').then((r) => r.json()),
      apiFetch('/api/settings').then((r) => r.json()),
    ]);
    if (!st.ok) throw new Error(st.error || 'Status failed');
    setRagStatus(st);
    setSources(src.sources || []);
    setDocuments(docs.documents || []);
    setSettings({
      ragEnabled: Boolean(cfg.ragEnabled),
      ragAutoInject: Boolean(cfg.ragAutoInject),
      embeddingProvider: cfg.embeddingProvider || 'openai',
      embeddingModel: cfg.embeddingModel || 'text-embedding-3-small',
      embeddingDimensions: cfg.embeddingDimensions ?? 1536,
      ragTopK: cfg.ragTopK ?? 8,
      ragMinScore: cfg.ragMinScore ?? 0.25,
    });
    setStatus('');
  }, []);

  useEffect(() => {
    load().catch((e) => setStatus(e.message));
  }, [load]);

  async function saveSettings() {
    setStatus('Saving…');
    const r = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Settings saved.');
    await load();
  }

  async function runIngest() {
    setStatus('Ingesting…');
    const acl =
      ingest.aclMode === 'public'
        ? { public: true }
        : {
            userIds: ingest.aclUserIds
              .split(/[\s,;]+/)
              .map((x) => Number(x.trim()))
              .filter((n) => Number.isFinite(n) && n > 0),
          };
    const r = await apiFetch('/api/knowledge/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceSlug: ingest.sourceSlug,
        sourceTitle: ingest.sourceTitle,
        sourceType: ingest.sourceType,
        documentTitle: ingest.documentTitle,
        externalId: ingest.externalId,
        uri: ingest.uri,
        content: ingest.content,
        acl,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ingest failed');
    setStatus(`Ingested ${j.chunkCount ?? 0} chunk(s).`);
    setIngest((prev) => ({ ...prev, content: '' }));
    await load();
  }

  async function deleteDoc(id) {
    if (!window.confirm(`Delete document #${id}?`)) return;
    setStatus('Deleting…');
    const r = await apiFetch(`/api/knowledge/documents/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Delete failed');
    setStatus('Deleted.');
    await load();
  }

  const stats = ragStatus?.stats || {};

  return (
    <PageSection title="Knowledge base (RAG)">
      <p className="hint">
        Manage internal documents for the <code>search_knowledge</code> agent tool. For the full legacy panel (file
        upload &amp; batch JSON), use{' '}
        <Link href="/admin/legacy#knowledge">Full panel → Knowledge</Link>.
      </p>
      {status ? <p className="hint">{status}</p> : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            RAG: {ragStatus?.ragEnabled ? 'enabled' : 'disabled'} · Embeddings:{' '}
            {ragStatus?.embeddingsConfigured ? 'ready' : 'not configured'} · pgvector:{' '}
            {ragStatus?.pgvector ? 'yes' : 'no'}
          </p>
          <p>
            Corpus: {stats.sources ?? 0} sources, {stats.documents ?? 0} documents, {stats.chunks ?? 0} chunks
          </p>
          <Button variant="outline" size="sm" onClick={() => load().catch((e) => setStatus(e.message))}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>RAG settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 max-w-lg">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.ragEnabled}
              onChange={(e) => setSettings((s) => ({ ...s, ragEnabled: e.target.checked }))}
            />
            Enable RAG
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.ragAutoInject}
              onChange={(e) => setSettings((s) => ({ ...s, ragAutoInject: e.target.checked }))}
            />
            Auto-inject into chat prompt
          </label>
          <div>
            <Label>Embedding provider</Label>
            <Select
              value={settings.embeddingProvider}
              onValueChange={(v) => setSettings((s) => ({ ...s, embeddingProvider: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Embedding model</Label>
            <Input
              value={settings.embeddingModel}
              onChange={(e) => setSettings((s) => ({ ...s, embeddingModel: e.target.value }))}
            />
          </div>
          <Button onClick={() => saveSettings().catch((e) => setStatus(e.message))}>Save settings</Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Ingest document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Input
            placeholder="Source slug"
            value={ingest.sourceSlug}
            onChange={(e) => setIngest((s) => ({ ...s, sourceSlug: e.target.value }))}
          />
          <Input
            placeholder="Document title"
            value={ingest.documentTitle}
            onChange={(e) => setIngest((s) => ({ ...s, documentTitle: e.target.value }))}
          />
          <Textarea
            rows={8}
            placeholder="Markdown content…"
            value={ingest.content}
            onChange={(e) => setIngest((s) => ({ ...s, content: e.target.value }))}
          />
          <Button onClick={() => runIngest().catch((e) => setStatus(e.message))}>Ingest</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No documents yet.</TableCell>
                </TableRow>
              ) : (
                documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.id}</TableCell>
                    <TableCell>{d.title}</TableCell>
                    <TableCell>
                      <code>{d.source_slug}</code>
                    </TableCell>
                    <TableCell>{d.chunk_count ?? 0}</TableCell>
                    <TableCell>{formatWhen(d.updated_at)}</TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" onClick={() => deleteDoc(d.id)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {sources.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {sources.map((s) => (
                <li key={s.id}>
                  <code>{s.slug}</code> — {s.title} ({s.document_count ?? 0} docs)
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </PageSection>
  );
}
