/**
 * Admin Knowledge (RAG) panel — loaded before app.js; uses window.SenaKnowledgePanel.
 */
(function initKnowledgePanelModule() {
  const $ = (id) => document.getElementById(id);

  function apiFetch(url, opts = {}) {
    return fetch(url, { ...opts, credentials: opts.credentials ?? 'include' });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setPanelStatus(msg, kind) {
    const el = $('knowledgePanelStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = kind === 'err' ? 'status err' : kind === 'ok' ? 'status ok' : 'status';
  }

  function parseAclFromForm() {
    const mode = String($('knowledgeAclMode')?.value || 'public').toLowerCase();
    if (mode === 'public') return { public: true };
    const raw = String($('knowledgeAclUserIds')?.value || '').trim();
    const userIds = raw
      .split(/[\s,;]+/)
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!userIds.length) throw new Error('Enter at least one soul user id for restricted ACL.');
    return { userIds };
  }

  async function loadKnowledgeStatus() {
    const body = $('knowledgeStatusBody');
    if (!body) return;
    body.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/knowledge/status');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Status failed');
      const st = j.stats || {};
      body.innerHTML =
        `<p><strong>RAG:</strong> ${j.ragEnabled ? 'enabled' : 'disabled'} · ` +
        `<strong>Embeddings:</strong> ${j.embeddingsConfigured ? 'ready' : 'not configured'} · ` +
        `<strong>pgvector:</strong> ${j.pgvector ? 'yes' : 'no (JSON fallback)'}</p>` +
        `<p><strong>Provider:</strong> ${escapeHtml(j.embeddingProvider || '—')} · ` +
        `<strong>Model:</strong> <code>${escapeHtml(j.embeddingModel || '—')}</code></p>` +
        `<p><strong>Corpus:</strong> ${st.sources ?? 0} source(s), ${st.documents ?? 0} document(s), ${st.chunks ?? 0} chunk(s)</p>`;
    } catch (e) {
      body.textContent = e.message;
    }
  }

  async function loadKnowledgeSources() {
    const tbody = $('knowledgeSourcesBody');
    if (!tbody) return;
    try {
      const r = await apiFetch('/api/knowledge/sources');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load sources');
      const rows = j.sources || [];
      tbody.innerHTML = rows.length
        ? rows
            .map(
              (s) =>
                `<tr><td><code>${escapeHtml(s.slug)}</code></td><td>${escapeHtml(s.title)}</td>` +
                `<td>${escapeHtml(s.source_type || '')}</td><td>${s.document_count ?? 0}</td>` +
                `<td class="nowrap">${escapeHtml(String(s.updated_at || '').slice(0, 19))}</td></tr>`,
            )
            .join('')
        : '<tr><td colspan="5" class="hint">No sources yet — ingest a document below.</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="hint">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function loadKnowledgeDocuments() {
    const tbody = $('knowledgeDocsBody');
    if (!tbody) return;
    try {
      const r = await apiFetch('/api/knowledge/documents?limit=200');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load documents');
      const rows = j.documents || [];
      tbody.innerHTML = rows.length
        ? rows
            .map(
              (d) =>
                `<tr><td>${d.id}</td><td>${escapeHtml(d.title)}</td><td><code>${escapeHtml(d.source_slug)}</code></td>` +
                `<td>${d.chunk_count ?? 0}</td><td class="nowrap">${escapeHtml(String(d.updated_at || '').slice(0, 19))}</td>` +
                `<td class="nowrap"><button type="button" class="btn-mini danger" data-knowledge-delete="${d.id}">Delete</button></td></tr>`,
            )
            .join('')
        : '<tr><td colspan="6" class="hint">No documents ingested yet.</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="hint">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function loadKnowledgeSettings() {
    try {
      const r = await apiFetch('/api/settings');
      const s = await r.json();
      if (!r.ok) return;
      if ($('knowledgeRagEnabled')) $('knowledgeRagEnabled').checked = Boolean(s.ragEnabled);
      if ($('knowledgeRagAutoInject')) $('knowledgeRagAutoInject').checked = Boolean(s.ragAutoInject);
      if ($('knowledgeEmbeddingProvider')) $('knowledgeEmbeddingProvider').value = s.embeddingProvider || 'openai';
      if ($('knowledgeEmbeddingModel')) $('knowledgeEmbeddingModel').value = s.embeddingModel || 'text-embedding-3-small';
      if ($('knowledgeEmbeddingDimensions')) $('knowledgeEmbeddingDimensions').value = s.embeddingDimensions ?? 1536;
      if ($('knowledgeRagTopK')) $('knowledgeRagTopK').value = s.ragTopK ?? 8;
      if ($('knowledgeRagMinScore')) $('knowledgeRagMinScore').value = s.ragMinScore ?? 0.25;
    } catch {
      /* ignore */
    }
  }

  async function saveKnowledgeSettings() {
    setPanelStatus('Saving RAG settings…');
    const body = {
      ragEnabled: Boolean($('knowledgeRagEnabled')?.checked),
      ragAutoInject: Boolean($('knowledgeRagAutoInject')?.checked),
      embeddingProvider: $('knowledgeEmbeddingProvider')?.value,
      embeddingModel: String($('knowledgeEmbeddingModel')?.value || '').trim(),
      embeddingDimensions: Number($('knowledgeEmbeddingDimensions')?.value),
      ragTopK: Number($('knowledgeRagTopK')?.value),
      ragMinScore: Number($('knowledgeRagMinScore')?.value),
    };
    const r = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setPanelStatus('RAG settings saved.', 'ok');
    await loadKnowledgeStatus();
  }

  async function ingestSingleDocument() {
    const content = String($('knowledgeContent')?.value || '').trim();
    if (!content) throw new Error('Document content is required.');
    const acl = parseAclFromForm();
    setPanelStatus('Embedding and ingesting…');
    const r = await apiFetch('/api/knowledge/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceSlug: $('knowledgeSourceSlug')?.value,
        sourceTitle: $('knowledgeSourceTitle')?.value,
        sourceType: $('knowledgeSourceType')?.value || 'wiki',
        documentTitle: $('knowledgeDocumentTitle')?.value,
        externalId: $('knowledgeExternalId')?.value,
        uri: $('knowledgeUri')?.value,
        content,
        acl,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ingest failed');
    setPanelStatus(`Ingested ${j.chunkCount ?? 0} chunk(s) into document #${j.documentId}.`, 'ok');
    if ($('knowledgeContent')) $('knowledgeContent').value = '';
    await refreshAll();
  }

  async function ingestBatchJson() {
    const raw = String($('knowledgeBatchJson')?.value || '').trim();
    if (!raw) throw new Error('Paste batch JSON first.');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
    setPanelStatus('Batch ingesting…');
    const r = await apiFetch('/api/knowledge/ingest/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Batch ingest failed');
    setPanelStatus(`Batch complete: ${j.count ?? 0} document(s).`, 'ok');
    await refreshAll();
  }

  async function ingestMarkdownFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
    if (!files.length) throw new Error('Choose one or more .md / .txt files.');
    const sourceSlug = String($('knowledgeSourceSlug')?.value || 'wiki-import').trim();
    const sourceTitle = String($('knowledgeSourceTitle')?.value || 'Wiki import').trim();
    const acl = parseAclFromForm();
    setPanelStatus(`Reading ${files.length} file(s)…`);
    const documents = [];
    for (const file of files) {
      const text = await file.text();
      const base = file.name.replace(/\.(md|markdown|txt)$/i, '') || file.name;
      documents.push({
        title: base,
        externalId: base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
        content: text,
        uri: `file://${file.name}`,
      });
    }
    const r = await apiFetch('/api/knowledge/ingest/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSlug, sourceTitle, sourceType: 'wiki', acl, documents }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'File ingest failed');
    setPanelStatus(`Imported ${j.count ?? 0} file(s).`, 'ok');
    if ($('knowledgeFileInput')) $('knowledgeFileInput').value = '';
    await refreshAll();
  }

  async function deleteDocument(id) {
    if (!window.confirm(`Delete knowledge document #${id} and all its chunks?`)) return;
    setPanelStatus('Deleting…');
    const r = await apiFetch(`/api/knowledge/documents/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Delete failed');
    setPanelStatus('Document deleted.', 'ok');
    await refreshAll();
  }

  async function refreshAll() {
    await Promise.all([
      loadKnowledgeStatus(),
      loadKnowledgeSources(),
      loadKnowledgeDocuments(),
      loadKnowledgeSettings(),
    ]);
  }

  function bindKnowledgePanel() {
    $('btnKnowledgeRefresh')?.addEventListener('click', () => {
      refreshAll().catch((e) => setPanelStatus(e.message, 'err'));
    });
    $('btnKnowledgeSaveSettings')?.addEventListener('click', () => {
      saveKnowledgeSettings().catch((e) => setPanelStatus(e.message, 'err'));
    });
    $('btnKnowledgeIngest')?.addEventListener('click', () => {
      ingestSingleDocument().catch((e) => setPanelStatus(e.message, 'err'));
    });
    $('btnKnowledgeBatchIngest')?.addEventListener('click', () => {
      ingestBatchJson().catch((e) => setPanelStatus(e.message, 'err'));
    });
    $('knowledgeFileInput')?.addEventListener('change', (ev) => {
      const files = ev.target?.files;
      if (!files?.length) return;
      ingestMarkdownFiles(files).catch((e) => setPanelStatus(e.message, 'err'));
    });
    $('knowledgeAclMode')?.addEventListener('change', () => {
      const restricted = $('knowledgeAclMode')?.value === 'restricted';
      const wrap = $('knowledgeAclUserIdsWrap');
      if (wrap) wrap.hidden = !restricted;
    });
    $('panel-knowledge')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-knowledge-delete]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-knowledge-delete'));
      if (!Number.isFinite(id)) return;
      deleteDocument(id).catch((e) => setPanelStatus(e.message, 'err'));
    });
  }

  window.SenaKnowledgePanel = {
    load: refreshAll,
    bind: bindKnowledgePanel,
  };
})();
