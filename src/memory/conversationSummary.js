import { listChatMessages } from '../chat/chatLog.js';
import { chat } from '../llm/ollama.js';
import { logger } from '../logger.js';
import { ensureSoul, getSoul, mergeProfileMemorySummary } from './soul.js';

const MAX_TRANSCRIPT = 28000;
const MAX_SUMMARY = 4000;

/**
 * Rebuilds profile.memorySummary from recent chat + previous summary (LLM).
 * Runs after turns; failures are logged only.
 */
export async function refreshConversationMemorySummary(userId) {
  ensureSoul(userId);
  const rows = listChatMessages({ userId, limit: 80 });
  if (rows.length < 2) return;

  const soul = getSoul(userId);
  const prev = String(soul.preferences?.profile?.memorySummary || '').trim();

  const transcript = rows
    .map((m) => `${m.role}: ${String(m.content || '').slice(0, 6000)}`)
    .join('\n');
  const clipped = transcript.length > MAX_TRANSCRIPT ? transcript.slice(-MAX_TRANSCRIPT) : transcript;

  const system =
    'You maintain a persistent memory summary for a personal assistant. Output plain text only (short paragraphs or bullets). ' +
    `Max ${MAX_SUMMARY} characters. Include: user situation, ongoing projects/work, goals, people, preferences, dates/deadlines if mentioned. ` +
    'Ignore small talk unless it matters later. If the conversation is only greetings, keep the previous summary mostly unchanged.';

  const userMsg =
    `Previous memory summary:\n${prev || '(none yet)'}\n\n` +
    `Conversation (oldest to newest within window):\n${clipped}\n\n` +
    'Write the UPDATED memory summary for future assistant turns:';

  const out = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
    { temperature: 0.15, timeoutMs: 120000 }
  );
  const text = String(out || '')
    .trim()
    .slice(0, MAX_SUMMARY);
  if (!text) return;
  mergeProfileMemorySummary(userId, text);
}

export function scheduleMemorySummaryRefresh(userId) {
  setImmediate(() => {
    refreshConversationMemorySummary(userId).catch((e) => {
      logger.warn(`conversation summary refresh failed for ${userId}: ${e.message}`);
    });
  });
}
