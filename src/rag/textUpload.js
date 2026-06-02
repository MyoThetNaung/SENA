/** Decode uploaded text files for personal RAG ingest. */
export function extractTextFromUpload({ fileName, fileBase64, content } = {}) {
  const direct = String(content || "").trim();
  if (direct) return { text: direct, title: fileName || "Untitled" };

  const b64 = String(fileBase64 || "").trim();
  if (!b64) throw new Error("Document content or fileBase64 is required.");

  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    throw new Error("Invalid fileBase64 encoding.");
  }
  if (buf.length > 2 * 1024 * 1024) {
    throw new Error("File too large (max 2 MB for text upload).");
  }

  const name = String(fileName || "upload.txt").trim();
  const lower = name.toLowerCase();
  const allowed = [".txt", ".md", ".markdown", ".json", ".csv", ".log"];
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw new Error("Supported file types: .txt, .md, .json, .csv, .log");
  }

  const text = buf.toString("utf8").trim();
  if (!text) throw new Error("File is empty or not valid UTF-8 text.");
  return { text, title: name.replace(/\.[^.]+$/, "") || "Untitled" };
}
