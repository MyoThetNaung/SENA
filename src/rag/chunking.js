const DEFAULT_CHUNK = 900;
const DEFAULT_OVERLAP = 120;

/**
 * Split markdown/plain text into overlapping chunks for embedding.
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 */
export function chunkText(text, opts = {}) {
  const maxChars = Math.min(
    4000,
    Math.max(200, Number(opts.maxChars) || DEFAULT_CHUNK),
  );
  const overlap = Math.min(
    maxChars / 2,
    Math.max(0, Number(opts.overlap) || DEFAULT_OVERLAP),
  );
  const raw = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!raw) return [];

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let buf = "";

  const flush = () => {
    const piece = buf.trim();
    if (piece) chunks.push(piece);
    buf = "";
  };

  for (const para of paragraphs) {
    if (!buf) {
      if (para.length <= maxChars) {
        buf = para;
        continue;
      }
      let start = 0;
      while (start < para.length) {
        const slice = para.slice(start, start + maxChars);
        chunks.push(slice.trim());
        start += maxChars - overlap;
        if (start >= para.length) break;
        if (start < 0) start = 0;
      }
      continue;
    }

    const candidate = `${buf}\n\n${para}`;
    if (candidate.length <= maxChars) {
      buf = candidate;
    } else {
      flush();
      if (para.length <= maxChars) buf = para;
      else {
        let start = 0;
        while (start < para.length) {
          chunks.push(para.slice(start, start + maxChars).trim());
          start += maxChars - overlap;
        }
      }
    }
  }
  flush();

  if (!chunks.length && raw.length) {
    let start = 0;
    while (start < raw.length) {
      chunks.push(raw.slice(start, start + maxChars).trim());
      start += maxChars - overlap;
    }
  }

  const out = [];
  let prev = "";
  for (const c of chunks) {
    if (!c) continue;
    if (prev && overlap > 0) {
      const tail = prev.slice(-overlap);
      if (c.startsWith(tail)) {
        out.push(c);
        prev = c;
        continue;
      }
    }
    out.push(c);
    prev = c;
  }
  return out;
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}
