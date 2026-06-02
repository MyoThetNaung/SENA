import { query } from "../db.js";
import { getConfig } from "../config.js";
import { principalsForUser, buildPrincipalMatchSql } from "./acl.js";
import { embedText, embeddingsConfigured } from "./embeddings.js";
import { rankByCosine } from "./cosine.js";
import { isPgvectorReady } from "./schema.js";

function parseEmbeddingJson(raw) {
  if (Array.isArray(raw)) return raw.map((x) => Number(x) || 0);
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.map((x) => Number(x) || 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * ACL-filtered semantic retrieval over ingested knowledge.
 * @param {number} userId
 * @param {string} queryText
 * @param {{ limit?: number, minScore?: number }} [opts]
 */
export async function retrieveContext(userId, queryText, opts = {}) {
  const cfg = getConfig();
  if (!cfg.ragEnabled) {
    return { chunks: [], contextText: "", error: "Knowledge RAG is disabled." };
  }
  if (!embeddingsConfigured()) {
    return {
      chunks: [],
      contextText: "",
      error:
        "Embeddings are not configured. Set embedding provider and API keys.",
    };
  }

  const q = String(queryText || "").trim();
  if (!q) return { chunks: [], contextText: "" };

  const limit = Math.min(
    20,
    Math.max(1, Number(opts.limit) || cfg.ragTopK || 8),
  );
  const minScore = Number(opts.minScore ?? cfg.ragMinScore ?? 0.25);

  const principals = principalsForUser(userId);
  const { sql: principalSql, params: principalParams } = buildPrincipalMatchSql(
    principals,
    1,
  );

  let queryVec;
  try {
    queryVec = await embedText(q);
  } catch (e) {
    return { chunks: [], contextText: "", error: e.message };
  }
  if (!queryVec.length) {
    return { chunks: [], contextText: "", error: "Failed to embed query." };
  }

  if (isPgvectorReady()) {
    const vecLit = `[${queryVec.join(",")}]`;
    const vecParam = principalParams.length + 1;
    const limitParam = principalParams.length + 2;
    const fetchLimit = Math.min(200, limit * 4);
    const r = await query(
      `SELECT DISTINCT ON (c.id)
              c.id, c.content, c.chunk_index, d.title AS document_title, d.uri, d.id AS document_id,
              1 - (c.embedding <=> $${vecParam}::vector) AS score
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       JOIN knowledge_document_acl a ON a.document_id = d.id
       WHERE (${principalSql})
         AND c.embedding IS NOT NULL
       ORDER BY c.id, c.embedding <=> $${vecParam}::vector
       LIMIT $${limitParam}`,
      [...principalParams, vecLit, fetchLimit],
    );
    const chunks = r.rows
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limit)
      .filter((row) => Number(row.score) >= minScore)
      .map((row) => ({
        id: Number(row.id),
        documentId: Number(row.document_id),
        documentTitle: row.document_title,
        uri: row.uri,
        chunkIndex: row.chunk_index,
        content: row.content,
        score: Number(row.score),
      }));
    return formatRetrievalResult(chunks);
  }

  const r = await query(
    `SELECT DISTINCT ON (c.id)
            c.id, c.content, c.embedding_json, c.chunk_index,
            d.title AS document_title, d.uri, d.id AS document_id
     FROM knowledge_chunks c
     JOIN knowledge_documents d ON d.id = c.document_id
     JOIN knowledge_document_acl a ON a.document_id = d.id
     WHERE (${principalSql})
     LIMIT 2000`,
    principalParams,
  );

  const candidates = r.rows.map((row) => ({
    id: Number(row.id),
    documentId: Number(row.document_id),
    documentTitle: row.document_title,
    uri: row.uri,
    chunkIndex: row.chunk_index,
    content: row.content,
    embedding: parseEmbeddingJson(row.embedding_json),
  }));

  const ranked = rankByCosine(queryVec, candidates, limit).filter(
    (x) => x.score >= minScore,
  );
  const chunks = ranked.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    uri: row.uri,
    chunkIndex: row.chunkIndex,
    content: row.content,
    score: row.score,
  }));

  return formatRetrievalResult(chunks);
}

function formatRetrievalResult(chunks) {
  if (!chunks.length) {
    return {
      chunks: [],
      contextText:
        "No matching knowledge base excerpts found for this user and query.",
    };
  }
  const lines = chunks.map((c, i) => {
    const cite = c.uri
      ? `[${i + 1}] ${c.documentTitle} (${c.uri})`
      : `[${i + 1}] ${c.documentTitle}`;
    return `${cite}\n${String(c.content || "").slice(0, 2500)}`;
  });
  const contextText = `Knowledge base excerpts (cite by bracket number):\n\n${lines.join("\n\n---\n\n")}`;
  return { chunks, contextText };
}

/** Format for agent tool / chat injection. */
export function formatKnowledgeToolReply(retrieval) {
  if (retrieval.error) return retrieval.error;
  if (!retrieval.chunks?.length) {
    return retrieval.contextText || "No relevant internal documents found.";
  }
  const cites = retrieval.chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.documentTitle}${c.uri ? ` — ${c.uri}` : ""} (score ${(c.score || 0).toFixed(2)})`,
    )
    .join("\n");
  return `${retrieval.contextText}\n\n---\nSources:\n${cites}`;
}
