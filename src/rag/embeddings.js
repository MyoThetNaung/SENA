import { getConfig } from "../config.js";
import { explainFetchError } from "../llm/fetchUtil.js";
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

/**
 * @returns {boolean}
 */
export function embeddingsConfigured() {
  const c = getConfig();
  if (!c.ragEnabled) return false;
  const provider = String(c.embeddingProvider || "").toLowerCase();
  if (provider === "openai")
    return Boolean(String(c.openaiApiKey || "").trim());
  if (provider === "ollama")
    return Boolean(String(c.ollamaBaseUrl || "").trim());
  return false;
}

async function openAiEmbed(texts, model, dimensions) {
  const key = String(getConfig().openaiApiKey || "").trim();
  if (!key) throw new Error("OpenAI API key required for embeddings.");

  const body = { model, input: texts };
  if (dimensions && model.includes("embedding-3")) {
    body.dimensions = dimensions;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(OPENAI_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(
        `OpenAI embeddings HTTP ${res.status}: ${raw.slice(0, 300)}`,
      );
    }
    const data = JSON.parse(raw);
    const items = Array.isArray(data?.data) ? data.data : [];
    items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return items.map((row) => {
      const emb = row?.embedding;
      if (!Array.isArray(emb))
        throw new Error("OpenAI embeddings: missing vector");
      return emb.map((x) => Number(x) || 0);
    });
  } catch (e) {
    if (String(e?.message || "").startsWith("OpenAI embeddings HTTP")) throw e;
    throw new Error(
      explainFetchError(e, OPENAI_EMBED_URL, "OpenAI embeddings"),
    );
  } finally {
    clearTimeout(t);
  }
}

async function ollamaEmbed(texts, model) {
  const base = getConfig().ollamaBaseUrl.replace(/\/$/, "");
  const url = `${base}/api/embeddings`;
  const vectors = [];
  for (const text of texts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text }),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(
          `Ollama embeddings HTTP ${res.status}: ${raw.slice(0, 300)}`,
        );
      }
      const data = JSON.parse(raw);
      const emb = data?.embedding;
      if (!Array.isArray(emb))
        throw new Error("Ollama embeddings: missing vector");
      vectors.push(emb.map((x) => Number(x) || 0));
    } catch (e) {
      if (String(e?.message || "").startsWith("Ollama embeddings HTTP"))
        throw e;
      throw new Error(explainFetchError(e, url, "Ollama embeddings"));
    } finally {
      clearTimeout(t);
    }
  }
  return vectors;
}

/**
 * @param {string[]} texts
 */
export async function embedTexts(texts) {
  const c = getConfig();
  if (!c.ragEnabled) throw new Error("Knowledge RAG is disabled.");
  const inputs = texts.map((t) => String(t || "").trim()).filter(Boolean);
  if (!inputs.length) return [];

  const provider = String(c.embeddingProvider || "openai").toLowerCase();
  const model = String(c.embeddingModel || "text-embedding-3-small").trim();
  const dimensions = Math.max(
    1,
    Math.floor(Number(c.embeddingDimensions) || 1536),
  );

  if (provider === "ollama") {
    return ollamaEmbed(inputs, model);
  }

  const batchSize = 32;
  const out = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize);
    const part = await openAiEmbed(slice, model, dimensions);
    out.push(...part);
  }
  return out;
}

/** @param {string} text */
export async function embedText(text) {
  const [vec] = await embedTexts([text]);
  return vec || [];
}
