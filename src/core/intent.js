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
  /* Questions about one saved purchase/medicine row → CHAT (records are in context; avoid dumping the whole table). */
  const textRaw = String(text || '');
  const looksLikeRecordLookup =
    /\b(when|how much|how many|which day|what day|did i pay|did i buy|what did i pay|what did i buy)\b/i.test(t) ||
    /ဘယ်နေ့|ဘယ်တော့|ဘယ်လောက်|ဝယ်ခဲ့|ပေးရမှာ|ပေးဖို့|ပေးရမလဲ|တုန်းက/u.test(textRaw);
  const explicitFullList =
    /\b(list|show|display|print)\b.*\b(all|everything|full)\b/i.test(t) ||
    /\b(all|every|full)\b.*\b(saved\s+)?(row|purchase|record)/i.test(t) ||
    /စာရင်း.*ပြပါ|ပြပါ.*စာရင်း|အားလုံး.*ပြပါ|ဘာတွေစွဲထားလဲ/u.test(textRaw);
  if (looksLikeRecordLookup && !explicitFullList) {
    return 'CHAT';
  }
  if (
    getConfig().webSearchEnabled &&
    (/\b(search|look up|google)\b.+\b(for|about)\b/.test(t) ||
      /\b(latest news|current price|what happened today)\b/.test(t))
  ) {
    return 'SEARCH';
  }
  if (
    /\b(i\s+)?sold\s+\d{1,9}\b/i.test(textRaw) &&
    !/\b(how much did i sell|when did i sell)\b/i.test(t)
  ) {
    return 'NOTEBOOK';
  }
  if (
    /\b(add|save|log|record|put)\b.+\b(in\s+(the\s+)?table|to\s+(my\s+)?(table|log))\b/.test(t) ||
    /\b(record|save|log)\b.+\b(buying|inventory|stock|purchase)\b.+\b(list|lines|sheet|items|products)\b/i.test(
      t
    ) ||
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
