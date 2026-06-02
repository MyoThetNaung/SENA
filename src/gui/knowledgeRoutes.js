import { Router } from "express";
import { getPool } from "../db.js";
import {
  ingestDocument,
  ingestDocumentBatch,
  listKnowledgeSources,
  listKnowledgeDocuments,
  getKnowledgeStats,
  deleteKnowledgeDocument,
} from "../rag/ingest.js";
import { isPgvectorReady } from "../rag/schema.js";
import { embeddingsConfigured } from "../rag/embeddings.js";
import { getConfig } from "../config.js";

export function createKnowledgeRouter() {
  const router = Router();

  router.get("/status", async (req, res) => {
    try {
      await getPool();
      const cfg = getConfig();
      const stats = await getKnowledgeStats();
      res.json({
        ok: true,
        ragEnabled: cfg.ragEnabled,
        embeddingsConfigured: embeddingsConfigured(),
        pgvector: isPgvectorReady(),
        embeddingProvider: cfg.embeddingProvider,
        embeddingModel: cfg.embeddingModel,
        stats,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get("/sources", async (req, res) => {
    try {
      await getPool();
      const sources = await listKnowledgeSources();
      res.json({ ok: true, sources });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get("/documents", async (req, res) => {
    try {
      await getPool();
      const limit = Number(req.query.limit) || 200;
      const documents = await listKnowledgeDocuments(limit);
      res.json({ ok: true, documents });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/ingest", async (req, res) => {
    try {
      await getPool();
      const b = req.body || {};
      const result = await ingestDocument({
        sourceSlug: b.sourceSlug,
        sourceTitle: b.sourceTitle,
        sourceType: b.sourceType,
        documentTitle: b.documentTitle,
        content: b.content,
        externalId: b.externalId,
        uri: b.uri,
        metadata: b.metadata,
        acl: b.acl,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  /** Batch ingest (wiki export): { sourceSlug, sourceTitle, documents: [{ title, content, ... }] } */
  router.post("/ingest/batch", async (req, res) => {
    try {
      await getPool();
      const b = req.body || {};
      const result = await ingestDocumentBatch({
        sourceSlug: b.sourceSlug,
        sourceTitle: b.sourceTitle,
        sourceType: b.sourceType,
        acl: b.acl,
        documents: b.documents,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete("/documents/:id", async (req, res) => {
    try {
      await getPool();
      const ok = await deleteKnowledgeDocument(req.params.id);
      if (!ok) {
        res.status(404).json({ ok: false, error: "Document not found." });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
