import { query } from "../db.js";
import { chunkText, estimateTokens } from "./chunking.js";
import { normalizeAclPrincipals } from "./acl.js";
import { embedTexts } from "./embeddings.js";
import { isPgvectorReady } from "./schema.js";

/**
 * @param {object} opts
 * @param {string} opts.sourceSlug
 * @param {string} opts.sourceTitle
 * @param {string} [opts.sourceType]
 * @param {string} opts.documentTitle
 * @param {string} opts.content
 * @param {string} [opts.externalId]
 * @param {string} [opts.uri]
 * @param {object} [opts.metadata]
 * @param {object} [opts.acl]
 */
export async function ingestDocument(opts) {
  const sourceSlug = String(opts.sourceSlug || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 120);
  const sourceTitle = String(opts.sourceTitle || sourceSlug)
    .trim()
    .slice(0, 500);
  const sourceType = String(opts.sourceType || "wiki")
    .trim()
    .slice(0, 40);
  const documentTitle = String(opts.documentTitle || "Untitled")
    .trim()
    .slice(0, 500);
  const content = String(opts.content || "").trim();
  if (!content) throw new Error("Document content is empty.");

  const externalId = String(opts.externalId ?? documentTitle)
    .trim()
    .slice(0, 500);
  const uri = String(opts.uri || "")
    .trim()
    .slice(0, 2000);
  const metadata =
    opts.metadata && typeof opts.metadata === "object" ? opts.metadata : {};

  const src = await query(
    `INSERT INTO knowledge_sources (slug, title, source_type, updated_at)
     VALUES ($1, $2, $3, timezone('utc', now()))
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title,
       source_type = EXCLUDED.source_type,
       updated_at = timezone('utc', now())
     RETURNING id`,
    [sourceSlug, sourceTitle, sourceType],
  );
  const sourceId = Number(src.rows[0].id);

  const doc = await query(
    `INSERT INTO knowledge_documents (source_id, external_id, title, uri, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, timezone('utc', now()))
     ON CONFLICT (source_id, external_id) DO UPDATE SET
       title = EXCLUDED.title,
       uri = EXCLUDED.uri,
       metadata = EXCLUDED.metadata,
       updated_at = timezone('utc', now())
     RETURNING id`,
    [sourceId, externalId, documentTitle, uri, JSON.stringify(metadata)],
  );
  const documentId = Number(doc.rows[0].id);

  await query(`DELETE FROM knowledge_document_acl WHERE document_id = $1`, [
    documentId,
  ]);
  const principals = normalizeAclPrincipals(opts.acl);
  for (const p of principals) {
    await query(
      `INSERT INTO knowledge_document_acl (document_id, principal_type, principal_value)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [documentId, p.principal_type, p.principal_value],
    );
  }

  await query(`DELETE FROM knowledge_chunks WHERE document_id = $1`, [
    documentId,
  ]);

  const chunks = chunkText(content);
  const vectors = await embedTexts(chunks);
  if (vectors.length !== chunks.length) {
    throw new Error("Embedding count mismatch after ingest.");
  }

  const usePg = isPgvectorReady();
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const piece = chunks[i];
    const emb = vectors[i];
    const json = JSON.stringify(emb);
    if (usePg) {
      const vecLit = `[${emb.join(",")}]`;
      await query(
        `INSERT INTO knowledge_chunks (document_id, chunk_index, content, embedding_json, embedding, token_estimate)
         VALUES ($1, $2, $3, $4::jsonb, $5::vector, $6)`,
        [documentId, i, piece, json, vecLit, estimateTokens(piece)],
      );
    } else {
      await query(
        `INSERT INTO knowledge_chunks (document_id, chunk_index, content, embedding_json, token_estimate)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [documentId, i, piece, json, estimateTokens(piece)],
      );
    }
    inserted += 1;
  }

  return {
    sourceId,
    documentId,
    chunkCount: inserted,
    principals,
  };
}

/**
 * Wiki / Confluence export: array of { title, content, externalId?, uri?, acl? }
 * @param {object} batchOpts
 * @param {string} batchOpts.sourceSlug
 * @param {string} batchOpts.sourceTitle
 * @param {object[]} batchOpts.documents
 */
export async function ingestDocumentBatch(batchOpts) {
  const docs = Array.isArray(batchOpts.documents) ? batchOpts.documents : [];
  const results = [];
  for (const d of docs) {
    const r = await ingestDocument({
      sourceSlug: batchOpts.sourceSlug,
      sourceTitle: batchOpts.sourceTitle,
      sourceType: batchOpts.sourceType,
      documentTitle: d.title,
      content: d.content,
      externalId: d.externalId,
      uri: d.uri,
      metadata: d.metadata,
      acl: d.acl ?? batchOpts.acl,
    });
    results.push(r);
  }
  return { count: results.length, documents: results };
}

export async function listKnowledgeSources() {
  const r = await query(
    `SELECT s.id, s.slug, s.title, s.source_type, s.created_at, s.updated_at,
            COUNT(DISTINCT d.id)::int AS document_count
     FROM knowledge_sources s
     LEFT JOIN knowledge_documents d ON d.source_id = s.id
     GROUP BY s.id
     ORDER BY s.slug`,
  );
  return r.rows;
}

export async function listKnowledgeDocuments(limit = 200) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  const r = await query(
    `SELECT d.id, d.title, d.external_id, d.uri, d.created_at, d.updated_at,
            s.slug AS source_slug, s.title AS source_title,
            (SELECT COUNT(*)::int FROM knowledge_chunks c WHERE c.document_id = d.id) AS chunk_count
     FROM knowledge_documents d
     JOIN knowledge_sources s ON s.id = d.source_id
     ORDER BY d.updated_at DESC
     LIMIT $1`,
    [lim],
  );
  return r.rows;
}

export async function getKnowledgeStats() {
  const r = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM knowledge_sources) AS sources,
      (SELECT COUNT(*)::int FROM knowledge_documents) AS documents,
      (SELECT COUNT(*)::int FROM knowledge_chunks) AS chunks
  `);
  return r.rows[0] || { sources: 0, documents: 0, chunks: 0 };
}

export async function deleteKnowledgeDocument(documentId) {
  const id = Number(documentId);
  if (!Number.isFinite(id)) return false;
  const r = await query(`DELETE FROM knowledge_documents WHERE id = $1`, [id]);
  return Number(r.rowCount || 0) > 0;
}
