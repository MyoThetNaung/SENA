import { addEvent, getTodayEvents, getUpcomingEvents } from '../calendar/calendar.js';
import { resolveEventStartsAt } from '../calendar/resolveStartsAt.js';
import {
  chat,
  parseCalendarRequest,
  summarizeWebContent,
  baseSystemPrompt,
} from '../llm/ollama.js';
import { decideIntent } from './intent.js';
import { formatSoulForPrompt, getSoul, ensureSoul } from '../memory/soul.js';
import { searchAndSummarize } from '../tools/browser.js';
import { clearPending, getPending, setPending } from './pending.js';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';

const YES = /^(yes|y|confirm|ok|okay|👍)$/i;
const NO = /^(no|n|cancel|stop|👎)$/i;

function formatEvents(rows) {
  if (!rows.length) return 'No events found.';
  return rows
    .map((r) => {
      const d = new Date(r.starts_at);
      return `• ${d.toLocaleString()}: ${r.title}`;
    })
    .join('\n');
}

function buildMessages(userId, userText) {
  const soul = getSoul(userId);
  const memoryBlock = formatSoulForPrompt(soul);
  const system = `${baseSystemPrompt(userId)}\n\n---\nUser memory (Soul ID):\n${memoryBlock}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];
}

async function handleCalendar(userId, text) {
  const parsed = await parseCalendarRequest(text);
  const op = String(parsed.op || 'upcoming').toLowerCase();

  if (op === 'today') {
    const rows = getTodayEvents(userId);
    return `Here's your schedule today:\n${formatEvents(rows)}`;
  }
  if (op === 'upcoming' || op === 'list') {
    const rows = getUpcomingEvents(userId);
    return `Upcoming events:\n${formatEvents(rows)}`;
  }
  if (op === 'add') {
    const title = String(parsed.title || 'Event').trim() || 'Event';
    let starts =
      resolveEventStartsAt(parsed.starts_at, text) || String(parsed.starts_at || '').trim();
    if (!starts) {
      return 'I could not understand the event time. Please include a clearer date and time (e.g. tomorrow at 3pm).';
    }
    const d = new Date(starts);
    if (Number.isNaN(d.getTime())) {
      return 'The event time was not valid. Please rephrase with a clear date/time.';
    }
    starts = d.toISOString();
    setPending(userId, 'add_event', { title, starts_at: starts });
    const when = new Date(starts).toLocaleString();
    return (
      `I will add this calendar event:\n` +
      `• ${title}\n` +
      `• ${when}\n\n` +
      `Reply Yes to confirm or No to cancel.`
    );
  }
  const rows = getUpcomingEvents(userId);
  return `Upcoming events:\n${formatEvents(rows)}`;
}

export async function handleTextMessage(userId, text) {
  const trimmed = text.trim();
  if (!trimmed) return { reply: 'Send a non-empty message.' };

  ensureSoul(userId);

  const pending = getPending(userId);
  if (pending) {
    if (YES.test(trimmed)) {
      if (pending.kind === 'web_search') {
        const q = pending.payload?.query || '';
        clearPending(userId);
        if (!q) return { reply: 'Nothing to search.' };
        if (!getConfig().webSearchEnabled) {
          try {
            const reply = await chat(buildMessages(userId, q), { timeoutMs: 120000 });
            return { reply: reply || '(empty model response)' };
          } catch (e) {
            logger.error(`Chat error: ${e.message}`);
            return { reply: `Model error: ${e.message}` };
          }
        }
        const res = await searchAndSummarize(q);
        if (!res.ok) {
          return { reply: `Web search failed: ${res.error}` };
        }
        const summary = await summarizeWebContent(q, res.pageTexts);
        return { reply: summary };
      }
      if (pending.kind === 'add_event') {
        const { title, starts_at } = pending.payload || {};
        clearPending(userId);
        try {
          const ev = addEvent(userId, starts_at, title);
          const when = new Date(ev.starts_at).toLocaleString();
          return { reply: `Added: "${ev.title}" at ${when}.` };
        } catch (e) {
          return { reply: `Could not add event: ${e.message}` };
        }
      }
      clearPending(userId);
      return { reply: 'Confirmation cleared.' };
    }
    if (NO.test(trimmed)) {
      clearPending(userId);
      return { reply: 'Cancelled.' };
    }
    return {
      reply:
        'You have a pending confirmation. Reply Yes to proceed, or No to cancel that request first.',
    };
  }

  let intent;
  try {
    intent = await decideIntent(trimmed);
  } catch (e) {
    logger.warn(`Intent classify failed, defaulting to CHAT: ${e.message}`);
    intent = 'CHAT';
  }

  if (intent === 'SEARCH' && getConfig().webSearchEnabled) {
    const q = trimmed.replace(/^\s*(search|look\s*up|google)\s*[:\s]*/i, '').trim() || trimmed;
    setPending(userId, 'web_search', { query: q });
    return {
      reply:
        `I can search the web (DuckDuckGo), open up to ${getConfig().maxBrowsePages} pages, and summarize.\n\n` +
        `Query: ${q}\n\n` +
        `Reply Yes to run this or No to cancel.`,
      wantConfirmKeyboard: true,
    };
  }

  if (intent === 'CALENDAR') {
    try {
      const reply = await handleCalendar(userId, trimmed);
      return { reply, wantConfirmKeyboard: getPending(userId)?.kind === 'add_event' };
    } catch (e) {
      logger.error(`Calendar handler error: ${e.message}`);
      return { reply: `Calendar error: ${e.message}` };
    }
  }

  try {
    const reply = await chat(buildMessages(userId, trimmed), { timeoutMs: 120000 });
    return { reply: reply || '(empty model response)' };
  } catch (e) {
    logger.error(`Chat error: ${e.message}`);
    return { reply: `Model error: ${e.message}` };
  }
}

export async function handleConfirmCallback(userId, accepted) {
  const pending = getPending(userId);
  if (!pending) {
    return { reply: 'No pending action.' };
  }
  if (!accepted) {
    clearPending(userId);
    return { reply: 'Cancelled.' };
  }
  if (pending.kind === 'web_search') {
    const q = pending.payload?.query || '';
    clearPending(userId);
    if (!q) return { reply: 'Nothing to search.' };
    if (!getConfig().webSearchEnabled) {
      try {
        const reply = await chat(buildMessages(userId, q), { timeoutMs: 120000 });
        return { reply: reply || '(empty model response)' };
      } catch (e) {
        logger.error(`Chat error: ${e.message}`);
        return { reply: `Model error: ${e.message}` };
      }
    }
    const res = await searchAndSummarize(q);
    if (!res.ok) {
      return { reply: `Web search failed: ${res.error}` };
    }
    const summary = await summarizeWebContent(q, res.pageTexts);
    return { reply: summary };
  }
  if (pending.kind === 'add_event') {
    const { title, starts_at } = pending.payload || {};
    clearPending(userId);
    try {
      const ev = addEvent(userId, starts_at, title);
      const when = new Date(ev.starts_at).toLocaleString();
      return { reply: `Added: "${ev.title}" at ${when}.` };
    } catch (e) {
      return { reply: `Could not add event: ${e.message}` };
    }
  }
  clearPending(userId);
  return { reply: 'Done.' };
}
