import { classifyIntent as classifyIntentLlm } from '../llm/ollama.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

/**
 * Fast path: obvious calendar / search phrases skip an extra model call.
 * Returns null if ambiguous — caller should use the LLM.
 */
export function keywordIntentHint(text) {
  const t = text.toLowerCase();
  if (
    /\b(schedule|calendar|meeting|reminder|event|appointments?)\b/.test(t) ||
    /\b(what'?s on|what do i have)\b/.test(t) ||
    /\b(add|create)\b.+\b(meeting|call|appointment|event)\b/.test(t) ||
    /\b(today|tomorrow|next week)\b.+\b(at|am|pm)\b/.test(t)
  ) {
    return 'CALENDAR';
  }
  if (
    getConfig().webSearchEnabled &&
    (/\b(search|look up|google)\b.+\b(for|about)\b/.test(t) ||
      /\b(latest news|current price|what happened today)\b/.test(t))
  ) {
    return 'SEARCH';
  }
  return null;
}

/** Full intent: keyword hint first, then Ollama classification. */
export async function decideIntent(userMessage) {
  const hint = keywordIntentHint(userMessage);
  if (hint) {
    logger.debug(`Intent keyword hint: ${hint}`);
    return hint;
  }
  return classifyIntentLlm(userMessage);
}
