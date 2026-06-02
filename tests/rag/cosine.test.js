import { describe, it, expect } from "vitest";
import { cosineSimilarity, rankByCosine } from "../../src/rag/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("ranks closer vectors higher", () => {
    const query = [1, 0];
    const ranked = rankByCosine(query, [
      { id: 1, embedding: [0, 1], content: "far" },
      { id: 2, embedding: [1, 0], content: "near" },
    ]);
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
