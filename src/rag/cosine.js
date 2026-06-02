/**
 * Cosine similarity between two equal-length float vectors.
 * @param {number[]} a
 * @param {number[]} b
 */
export function cosineSimilarity(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length ||
    a.length < 1
  ) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * @param {number[]} queryVec
 * @param {{ id: number, embedding: number[], content: string, [k: string]: unknown }[]} rows
 * @param {number} limit
 */
export function rankByCosine(queryVec, rows, limit = 8) {
  const scored = rows
    .map((row) => ({
      ...row,
      score: cosineSimilarity(queryVec, row.embedding),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit));
}
