import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/rag/chunking.js";

describe("chunkText", () => {
  it("returns empty for blank input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("splits long text into multiple chunks", () => {
    const para = "word ".repeat(400).trim();
    const chunks = chunkText(`${para}\n\n${para}`, { maxChars: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500 + 50);
    }
  });

  it("keeps short documents as one chunk", () => {
    expect(chunkText("Hello internal wiki.")).toEqual(["Hello internal wiki."]);
  });
});
