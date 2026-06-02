import { getConfig } from "../../config.js";
import { summarizeWebContent } from "../../llm/ollama.js";
import { searchAndSummarize } from "../browser.js";

/**
 * @param {object} args
 */
export async function handleWebSearch(args) {
  const cfg = getConfig();
  if (!cfg.webSearchEnabled) {
    return {
      ok: false,
      error:
        "Web search is disabled in settings. Enable it in the Control Panel to use this tool.",
    };
  }
  const query = String(args?.query || "").trim();
  if (!query) return { ok: false, error: "Search query is required." };

  const res = await searchAndSummarize(query);
  if (!res.ok) {
    return { ok: false, error: res.error || "Web search failed." };
  }
  const summary = await summarizeWebContent(query, res.pageTexts);
  return {
    ok: true,
    data: {
      query,
      text: summary || "(empty summary)",
    },
  };
}

export function previewWebSearch(args) {
  const q = String(args?.query || "").trim() || "(empty query)";
  return `Search the web for: "${q.slice(0, 200)}"?`;
}
