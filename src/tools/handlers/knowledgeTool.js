import { getConfig } from "../../config.js";
import {
  retrieveContext,
  formatKnowledgeToolReply,
} from "../../rag/retrieve.js";
import { embeddingsConfigured } from "../../rag/embeddings.js";

/**
 * @param {number} userId
 * @param {object} args
 */
export async function handleSearchKnowledge(userId, args) {
  const cfg = getConfig();
  if (!cfg.ragEnabled) {
    return {
      ok: false,
      error: "Internal knowledge search is disabled. Enable RAG in settings.",
    };
  }
  if (!embeddingsConfigured()) {
    return {
      ok: false,
      error:
        "Embeddings are not configured. Set embeddingProvider (openai or ollama) and credentials.",
    };
  }

  const query = String(args?.query || args?.q || "").trim();
  if (!query) return { ok: false, error: "query is required." };

  const limit = Math.min(
    20,
    Math.max(1, Number(args?.limit) || cfg.ragTopK || 8),
  );
  const retrieval = await retrieveContext(userId, query, { limit });
  if (retrieval.error) {
    return { ok: false, error: retrieval.error };
  }

  const text = formatKnowledgeToolReply(retrieval);
  return {
    ok: true,
    data: {
      query,
      matchCount: retrieval.chunks?.length || 0,
      chunks: retrieval.chunks,
      text,
    },
  };
}
