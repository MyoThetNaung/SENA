import { query } from "../db.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

let pgvectorReady = null;

function makeQuery(client) {
  return (text, params) =>
    client ? client.query(text, params) : query(text, params);
}

/**
 * Optional pgvector column for faster similarity search at scale.
 * @param {import('pg').PoolClient | null} [client]
 */
export async function ensurePgvector(client = null) {
  if (pgvectorReady !== null) return pgvectorReady;
  const q = makeQuery(client);
  try {
    await q("CREATE EXTENSION IF NOT EXISTS vector");
    const dim = Math.max(
      1,
      Math.floor(Number(getConfig().embeddingDimensions) || 1536),
    );
    await q(
      `ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(${dim})`,
    );
    try {
      await q(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
        ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
      `);
    } catch (idxErr) {
      logger.warn(`RAG: hnsw index skipped (${idxErr.message})`);
    }
    pgvectorReady = true;
    logger.info("RAG: pgvector extension ready");
  } catch (e) {
    pgvectorReady = false;
    logger.warn(
      `RAG: pgvector not available (${e.message}); using JSON embeddings + in-process ranking`,
    );
  }
  return pgvectorReady;
}

/** Called after main schema migration. @param {import('pg').PoolClient | null} [client] */
export async function ensureRagSchema(client = null) {
  await ensurePgvector(client);
}

export function isPgvectorReady() {
  return pgvectorReady === true;
}
