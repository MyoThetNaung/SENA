import { addEvent, getTodayEvents, getUpcomingEvents } from '../calendar/calendar.js';
import { resolveEventStartsAt, getCalendarClockContext } from '../calendar/resolveStartsAt.js';
import {
  chat,
  parseCalendarRequest,
  parseUserRecordRequest,
  summarizeWebContent,
  baseSystemPrompt,
  deterministicRuntimeIdentityReply,
} from '../llm/ollama.js';
import {
  addUserRecord,
  deleteUserRecordById,
  formatUserRecordsForPrompt,
  formatUserRecordsReply,
  normalizeOccurredOn,
} from '../records/userRecords.js';
import { decideIntent } from './intent.js';
import { formatSoulForPrompt, getSoul, ensureSoul } from '../memory/soul.js';
import { searchAndSummarize } from '../tools/browser.js';
import { clearPending, getPending } from './pending.js';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';

const YES = /^(yes|y|confirm|ok|okay|👍)$/i;
const NO = /^(no|n|cancel|stop|👎)$/i;

/** English-focused; avoids calling the LLM for “what model are you?” so small models cannot hallucinate Gemini/GPT. */
function isRuntimeLlmIdentityQuestion(text) {
  const s = String(text || '').trim();
  if (s.length > 220) return false;
  const lower = s.toLowerCase();
  if (/\b(fashion|role|data|os)\s+model\b/i.test(lower)) return false;
  if (/\bscale\s+model\b/i.test(lower)) return false;

  return (
    /\bwhat\s+model\s+are\s+you\b/i.test(lower) ||
    /\bwhich\s+model\s+are\s+you\b/i.test(lower) ||
    /\bwhat\s+(ai\s+)?model\s+(are\s+you|do\s+you\s+use|is\s+this)\b/i.test(lower) ||
    /\bwhich\s+(ai\s+)?model\s+(are\s+you|do\s+you\s+use|is\s+this)\b/i.test(lower) ||
    /\b(what|which)\s+llm\s+(are\s+you|do\s+you\s+use|is\s+this)\b/i.test(lower) ||
    /\bwhat\s+(ai|llm)\s+(are\s+you|is\s+this|do\s+you\s+use)\b/i.test(lower) ||
    /\bwhich\s+(ai|llm)\s+(are\s+you|is\s+this|do\s+you\s+use)\b/i.test(lower) ||
    /\b(what|which)\s+(ai|llm)\s+are\s+you\s+using\b/i.test(lower) ||
    /\b(what|which)\s+(backend|provider|engine)\s+(are\s+you|is\s+this|do\s+you\s+use)\b/i.test(lower) ||
    /\b(are\s+you)\s+(gpt|claude|gemini|chatgpt|openai)\b/i.test(lower)
  );
}

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
  const recordsBlock = formatUserRecordsForPrompt(userId, 45);
  const recordsSection = recordsBlock.startsWith('No structured records')
    ? recordsBlock
    : `Structured records (purchases / medicine — quote these for exact dates, prices, and names; do not invent rows):\n${recordsBlock}`;
  const system = `${baseSystemPrompt(userId)}\n\n---\nUser memory (Soul ID):\n${memoryBlock}\n\n---\n${recordsSection}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];
}

async function runWebSearch(userId, query) {
  if (!getConfig().webSearchEnabled) {
    try {
      const reply = await chat(buildMessages(userId, query), { timeoutMs: 120000 });
      return { reply: reply || '(empty model response)' };
    } catch (e) {
      logger.error(`Chat error: ${e.message}`);
      return { reply: `Model error: ${e.message}` };
    }
  }
  const res = await searchAndSummarize(query);
  if (!res.ok) {
    return { reply: `Web search failed: ${res.error}` };
  }
  const summary = await summarizeWebContent(query, res.pageTexts);
  return { reply: summary };
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
    try {
      const ev = addEvent(userId, starts, title);
      const when = new Date(ev.starts_at).toLocaleString();
      return `Added: "${ev.title}" at ${when}.`;
    } catch (e) {
      return `Could not add event: ${e.message}`;
    }
  }
  const rows = getUpcomingEvents(userId);
  return `Upcoming events:\n${formatEvents(rows)}`;
}

async function handleNotebook(userId, userText) {
  const ck = getCalendarClockContext();
  let parsed;
  try {
    parsed = await parseUserRecordRequest(userText);
  } catch (e) {
    logger.error(`parseUserRecordRequest: ${e.message}`);
    return `Could not parse that request: ${e.message}`;
  }
  const op = String(parsed.op || 'list').toLowerCase();

  if (op === 'delete') {
    let id = Number(parsed.delete_id);
    if (!Number.isFinite(id) || id < 1) {
      const m = String(userText).match(/\b(?:delete|remove)\s*(?:record\s*)?#?\s*(\d+)\b/i);
      if (m) id = Number(m[1]);
    }
    if (!Number.isFinite(id) || id < 1) {
      const hint = formatUserRecordsReply(userId, { limit: 15, record_type: null });
      return `Which row should I remove? Use the id number, e.g. "delete #12".\n\n${hint}`;
    }
    const ok = deleteUserRecordById(userId, id);
    if (!ok) return `No saved row with id ${id} for this user.`;
    return `Removed saved row #${id}.`;
  }

  if (op === 'list') {
    const lf = String(parsed.list_filter || parsed.record_type || '').toLowerCase();
    const filter = lf === 'purchase' || lf === 'medicine' ? lf : null;
    return formatUserRecordsReply(userId, {
      limit: 50,
      record_type: filter,
    });
  }

  if (op === 'add') {
    const title = String(parsed.title || '').trim();
    if (!title) {
      return 'Tell me what to save (item name or medicine name), and for purchases include price and currency if you can.';
    }
    let rt = String(parsed.record_type || '').toLowerCase();
    if (!['purchase', 'medicine', 'other'].includes(rt)) rt = 'other';
    let occurredOn = normalizeOccurredOn(parsed.occurred_on);
    if (!occurredOn && rt === 'purchase') occurredOn = ck.localDateYmd;
    const schedule = String(parsed.schedule || '').trim().slice(0, 500);
    const notes = String(parsed.notes || '').trim().slice(0, 2000);
    const meta = schedule ? { schedule } : {};
    let amount = parsed.amount;
    if (amount != null && amount !== '') {
      const n = Number(amount);
      amount = Number.isFinite(n) ? n : null;
    } else {
      amount = null;
    }
    const currency = parsed.currency != null ? String(parsed.currency).trim().slice(0, 12) : '';
    try {
      const row = addUserRecord(userId, {
        record_type: rt,
        title,
        occurred_on: occurredOn,
        amount,
        currency: currency || null,
        notes,
        meta,
      });
      const price =
        row.amount != null && Number.isFinite(Number(row.amount))
          ? ` · ${row.amount}${row.currency ? ' ' + row.currency : ''}`
          : '';
      const when = row.occurred_on ? ` · ${row.occurred_on}` : '';
      return `Saved to your table as #${row.id}: ${row.record_type} "${row.title}"${when}${price}. You can ask anytime (e.g. list my purchases or what medicine is logged).`;
    } catch (e) {
      return `Could not save: ${e.message}`;
    }
  }

  return formatUserRecordsReply(userId, { limit: 40, record_type: null });
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
        return runWebSearch(userId, q);
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

  if (isRuntimeLlmIdentityQuestion(trimmed)) {
    return { reply: deterministicRuntimeIdentityReply() };
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
    return runWebSearch(userId, q);
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

  if (intent === 'NOTEBOOK') {
    try {
      const reply = await handleNotebook(userId, trimmed);
      return { reply };
    } catch (e) {
      logger.error(`Notebook handler error: ${e.message}`);
      return { reply: `Table save error: ${e.message}` };
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
    return runWebSearch(userId, q);
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
