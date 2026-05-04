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
  if (
    /\b(add|save|log|record|put)\b.+\b(in\s+(the\s+)?table|to\s+(my\s+)?(table|log))\b/.test(t) ||
    /\b(medicine|medication|pill|tablet|dose)\b.+\b(log|schedule|table|record)\b/.test(t) ||
    /\b(purchase|bought|paid|spend|spending|price|thb|baht)\b.+\b(log|table|record)\b/.test(t) ||
    /\b(my\s+)?(purchases|spending)\s+(log|list|table)\b/.test(t) ||
    /\b(list|show)\b.+\b(saved|my)\b.+\b(purchases|medicine|medications|table|rows)\b/.test(t)
  ) {
    return 'NOTEBOOK';
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
