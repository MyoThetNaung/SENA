import { addEvent, getTodayEvents, getUpcomingEvents, getEventsForLocalDate } from '../calendar/calendar.js';
import { resolveEventStartsAt, getCalendarClockContext } from '../calendar/resolveStartsAt.js';
import {
  chat,
  parseCalendarRequest,
  parseBulkCalendarSchedule,
  parseBulkPurchaseLines,
  parseUserRecordRequest,
  summarizeWebContent,
  baseSystemPrompt,
  deterministicRuntimeIdentityReply,
} from '../llm/ollama.js';
import {
  addUserRecord,
  bulkAddPurchaseLines,
  deleteUserRecordById,
  formatInventoryNetByTitle,
  formatUserRecordsForPrompt,
  formatUserRecordsReply,
  normalizeOccurredOn,
  partitionBulkItemsAgainstExisting,
} from '../records/userRecords.js';
import { listChatMessages } from '../chat/chatLog.js';
import { decideIntent } from './intent.js';
import { formatSoulForPrompt, getSoul, ensureSoul } from '../memory/soul.js';
import { searchAndSummarize } from '../tools/browser.js';
import { clearPending, getPending } from './pending.js';
import { logger } from '../logger.js';
import { getConfig } from '../config.js';

const YES = /^(yes|y|confirm|ok|okay|👍)$/i;
const NO = /^(no|n|cancel|stop|👎)$/i;

/** Prior turns sent with each model call so follow-ups keep context (GUI/Telegram append user row before this runs). */
const CHAT_HISTORY_MSG_LIMIT = 48;

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

/** User clearly wants the raw full saved table, not a Q&A about one row. */
function isExplicitSavedTableListRequest(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  if (/\b(list|show|display|print|give)\s+(me\s+)?(all|everything|full)\b/i.test(lower)) return true;
  if (/\b(list|show|display)\b.*\b(all|every)\s+(saved\s+)?(purchase|row|record)/i.test(lower)) return true;
  if (/\b(all|full|complete)\s+(saved\s+)?(rows|records|purchases|table|log)\b/i.test(lower)) return true;
  if (/\b(my\s+)?(saved\s+)?(table|rows|notebook|log)\b.*\b(list|show|dump)\b/i.test(lower)) return true;
  if (/\b(list|show|display)\b.*\b(my\s+)?(saved\s+)?(purchase|purchases|medicine|medication|row|rows|log)\b/i.test(lower))
    return true;
  if (/စာရင်း.*ပြပါ|ပြပါ.*စာရင်း|အားလုံး.*ပြပါ|ဘာတွေစွဲထားလဲ/u.test(t)) return true;
  return false;
}

/** Pasted multi-line buying / inventory table — worth running bulk extract + save. */
function shouldTryBulkImport(text) {
  const raw = String(text || '').trim();
  if (raw.length < 120) return false;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 5) return false;
  const head = lines.slice(0, 6).join('\n').toLowerCase();
  const lower = raw.toLowerCase();
  const hasTableCue =
    /\t/.test(raw) ||
    lines.filter((l) => (l.match(/\|/g) || []).length >= 3).length >= 2 ||
    /\b(no\.?|product|type|qty|quantity|unit\s*price|total|yards)\b/i.test(head);
  const bigNums = (raw.match(/\d{3,}/g) || []).length >= 6;
  const hasIntentCue =
    /\b(record|save|add|log|inventory|buying list|purchase list|line items|stock list)\b/i.test(lower) ||
    /စာရင်း|မှတ်ပါ|သိမ်းပါ/u.test(raw);
  if (hasTableCue && (lines.length >= 6 || bigNums)) return true;
  if (lines.length >= 12 && bigNums && hasIntentCue) return true;
  if (lines.length >= 15 && bigNums) return true;
  return false;
}

function isBulkVerifyOnlyRequest(text) {
  const t = String(text || '').toLowerCase();
  return /\b(double\s+check|triple\s+check|did\s+i\s+save|already\s+saved|verify\s+(if|that|this)|check\s+(if|that)\s+(i\s+)?saved|duplicate\s+check)\b/i.test(
    t
  );
}

async function tryBulkSavePurchases(userId, userText) {
  if (!shouldTryBulkImport(userText)) return null;
  let parsed;
  try {
    parsed = await parseBulkPurchaseLines(userText);
  } catch (e) {
    logger.warn(`parseBulkPurchaseLines: ${e.message}`);
    return null;
  }
  const items = parsed.items || parsed.rows || [];
  if (!Array.isArray(items) || items.length < 1) return null;
  const lineCount = userText.split(/\r?\n/).filter((l) => l.trim()).length;
  if (items.length < 2 && !(lineCount >= 12 && items.length >= 1)) return null;
  const ck = getCalendarClockContext();
  const occurred_on = normalizeOccurredOn(parsed.occurred_on) || ck.localDateYmd;
  const currency = parsed.currency != null ? String(parsed.currency).trim().slice(0, 12) : null;
  const { toInsert, skippedCount, totalIncoming } = partitionBulkItemsAgainstExisting(userId, items, occurred_on);
  const verifyOnly = isBulkVerifyOnlyRequest(userText);

  if (verifyOnly) {
    const newCount = toInsert.length;
    if (skippedCount === totalIncoming) {
      return `Double-check: all ${totalIncoming} line(s) match data already saved (same date, amount, and title/serial fingerprint). Nothing was added.`;
    }
    if (skippedCount === 0) {
      return `Double-check: none of these ${totalIncoming} line(s) match existing rows — they look new. I did not add anything. Send again without "double check" (or say "save this list") to record them.`;
    }
    return `Double-check: ${skippedCount} line(s) already saved, ${newCount} look new. I did not add anything. Send again without "double check" to save only the ${newCount} new line(s), or paste a shorter message.`;
  }

  if (toInsert.length === 0) {
    return `All ${totalIncoming} line(s) match rows already on file (duplicate detection). Nothing new added.`;
  }

  let result;
  try {
    result = bulkAddPurchaseLines(userId, {
      occurred_on,
      currency,
      items: toInsert,
    });
  } catch (e) {
    logger.error(`bulkAddPurchaseLines: ${e.message}`);
    return null;
  }
  if (!result.count) return null;
  const range =
    result.firstId != null && result.lastId != null
      ? result.firstId === result.lastId
        ? `row id #${result.firstId}`
        : `row ids #${result.firstId}–#${result.lastId}`
      : '';
  const dupNote = skippedCount ? ` Skipped ${skippedCount} duplicate line(s) already saved.` : '';
  return `Saved ${result.count} new purchase line(s) to your table${range ? ` (${range})` : ''}.${dupNote} Ask totals per product, or say "list all my purchases" for the full dump.`;
}

function buildMessages(userId, userText) {
  const soul = getSoul(userId);
  const memoryBlock = formatSoulForPrompt(soul);
  const recordsBlock = formatUserRecordsForPrompt(userId, 100);
  const invNet = formatInventoryNetByTitle(userId, 500);
  const recordsSection = recordsBlock.startsWith('No structured records')
    ? recordsBlock
    : `Structured records (purchases / sales / medicine — authoritative facts only from this list; do not invent rows).\n` +
      `Rows with record type "sale (stock out)" have negative qty: subtract from inventory. Sum all qty values for the same product title (case-insensitive) to get on-hand quantity.\n` +
      `When the user asks how many / inventory / stock, use the pre-calculated net line below if present, and match product names flexibly (e.g. "3M Dobby" vs "3m dobby").\n` +
      `When the user asks about one fact, answer briefly. Do not paste the whole block unless they ask for the full list.\n${recordsBlock}` +
      (invNet
        ? `\n\n---\nPre-calculated net quantity (sum of qty for each product title; purchase + sale rows only):\n${invNet}`
        : '');
  const system =
    `${baseSystemPrompt(userId)}\n\n---\n` +
    `This request includes prior turns of this chat (user and assistant, oldest to newest) after the system block. ` +
    `Use them for follow-ups (e.g. "share the detail list", "same month", "break that down") without asking the user to repeat the whole topic.\n\n---\n` +
    `User memory (Soul ID):\n${memoryBlock}\n\n---\n${recordsSection}`;

  const messages = [{ role: 'system', content: system }];
  const rows = listChatMessages({ userId, limit: CHAT_HISTORY_MSG_LIMIT });
  for (const r of rows) {
    const role = String(r.role || '').toLowerCase();
    if (role === 'system') continue;
    if (role !== 'user' && role !== 'assistant') continue;
    messages.push({ role, content: String(r.content ?? '') });
  }
  const trimmed = String(userText ?? '').trim();
  const last = rows[rows.length - 1];
  const lastContent = last ? String(last.content ?? '').trim() : '';
  const lastRole = last ? String(last.role || '').toLowerCase() : '';
  if (!last || lastRole !== 'user' || lastContent !== trimmed) {
    messages.push({ role: 'user', content: trimmed });
  }
  return messages;
}

/** Multi-line Mon–Sun style schedule → many calendar events (not single parseCalendarRequest). */
function shouldTryBulkCalendarSchedule(text) {
  const raw = String(text || '').trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  if (!/\b(mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.test(raw)) {
    return false;
  }
  const ranges = raw.match(/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/g) || [];
  return ranges.length >= 2 || lines.length >= 6;
}

async function addManyCalendarEvents(userId, fullText, events) {
  const max = 60;
  const added = [];
  let failed = 0;
  for (const ev of events.slice(0, max)) {
    const title = String(ev.title || 'Event').trim().slice(0, 500) || 'Event';
    let starts =
      resolveEventStartsAt(ev.starts_at, fullText) || String(ev.starts_at || '').trim();
    if (!starts) {
      failed += 1;
      continue;
    }
    const d = new Date(starts);
    if (Number.isNaN(d.getTime())) {
      failed += 1;
      continue;
    }
    starts = d.toISOString();
    try {
      const row = addEvent(userId, starts, title);
      added.push(row);
    } catch {
      failed += 1;
    }
  }
  if (!added.length) {
    return 'Could not add any events from that schedule. Check each line has a weekday and start time, or try fewer lines at once.';
  }
  const preview = added
    .slice(0, 6)
    .map((r) => `• "${r.title}" — ${new Date(r.starts_at).toLocaleString()}`)
    .join('\n');
  const more = added.length > 6 ? `\n… and ${added.length - 6} more.` : '';
  let msg = `Added ${added.length} calendar event(s):\n${preview}${more}`;
  if (failed) msg += `\n(${failed} line(s) could not be parsed as valid times.)`;
  return msg;
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

function addCalendarDaysYmd(localYmd, deltaDays) {
  const parts = String(localYmd || '').split('-').map(Number);
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return null;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Fast path: "tomorrow plan", "May 6 … schedule" → one local calendar day. */
function keywordCalendarSingleDayQuery(text, localDateYmd) {
  const t = String(text || '').toLowerCase();
  const looksLikeDayQuery =
    /\b(plan|plans|schedule|calendar|anything|what)\b/.test(t) ||
    /\b(is there|do i have|any)\b.*\b(on|for)\b/.test(t);
  if (!looksLikeDayQuery && !/\b(on|for)\s+may\b/.test(t)) return null;

  if (/\b(day after tomorrow)\b/.test(t)) {
    const y = addCalendarDaysYmd(localDateYmd, 2);
    if (y) return { onDate: y, label: 'the day after tomorrow' };
  }
  if (/\btomorrow\b/.test(t)) {
    const y = addCalendarDaysYmd(localDateYmd, 1);
    if (y) return { onDate: y, label: 'tomorrow' };
  }
  if (/\b(today|this evening|tonight)\b/.test(t) && !/\btomorrow\b/.test(t)) {
    return { onDate: localDateYmd, label: 'today' };
  }

  const mIso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (mIso) {
    const ymd = `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
    if (normalizeOccurredOn(ymd)) return { onDate: ymd, label: ymd };
  }

  const mDow = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (mDow) {
    const mm = mDow[1].padStart(2, '0');
    const dd = mDow[2].padStart(2, '0');
    const ymd = `${mDow[3]}-${mm}-${dd}`;
    if (normalizeOccurredOn(ymd)) return { onDate: ymd, label: ymd };
  }

  const mMay = text.match(/\bmay\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i);
  if (mMay) {
    const dom = parseInt(mMay[1], 10);
    let year = mMay[2] ? parseInt(mMay[2], 10) : parseInt(localDateYmd.split('-')[0], 10);
    if (!mMay[2]) {
      const [cy, cm, cd] = localDateYmd.split('-').map(Number);
      const ref = new Date(cy, cm - 1, cd);
      ref.setHours(0, 0, 0, 0);
      let cand = new Date(year, 4, dom);
      cand.setHours(0, 0, 0, 0);
      if (cand < ref) year += 1;
    }
    const ymd = `${year}-05-${String(dom).padStart(2, '0')}`;
    if (normalizeOccurredOn(ymd)) return { onDate: ymd, label: `May ${dom}` };
  }

  const mJun = text.match(/\bjune\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i);
  if (mJun) {
    const dom = parseInt(mJun[1], 10);
    let year = mJun[2] ? parseInt(mJun[2], 10) : parseInt(localDateYmd.split('-')[0], 10);
    if (!mJun[2]) {
      const [cy, cm, cd] = localDateYmd.split('-').map(Number);
      const ref = new Date(cy, cm - 1, cd);
      ref.setHours(0, 0, 0, 0);
      let cand = new Date(year, 5, dom);
      cand.setHours(0, 0, 0, 0);
      if (cand < ref) year += 1;
    }
    const ymd = `${year}-06-${String(dom).padStart(2, '0')}`;
    if (normalizeOccurredOn(ymd)) return { onDate: ymd, label: `June ${dom}` };
  }

  return null;
}

async function handleCalendar(userId, text) {
  if (shouldTryBulkCalendarSchedule(text)) {
    try {
      const bulk = await parseBulkCalendarSchedule(text);
      const events = Array.isArray(bulk.events) ? bulk.events : [];
      if (events.length >= 1) {
        return await addManyCalendarEvents(userId, text, events);
      }
      return 'That looks like a weekly schedule, but I could not extract multiple time slots. Use lines like "Monday 08:00 - 12:00 : Title" and try again, or add a few events at a time.';
    } catch (e) {
      logger.warn(`parseBulkCalendarSchedule: ${e.message}`);
    }
  }

  const ck = getCalendarClockContext();
  const kwDay = keywordCalendarSingleDayQuery(text, ck.localDateYmd);
  if (kwDay && normalizeOccurredOn(kwDay.onDate)) {
    const rows = getEventsForLocalDate(userId, kwDay.onDate);
    const head =
      rows.length === 0
        ? `No calendar events on ${kwDay.label} (${kwDay.onDate}).`
        : `Your schedule for ${kwDay.label} (${kwDay.onDate}):`;
    const body = rows.length ? `\n${formatEvents(rows)}` : '';
    return `${head}${body}`;
  }

  const parsed = await parseCalendarRequest(text);
  const op = String(parsed.op || 'upcoming').toLowerCase();

  if (op === 'today') {
    const rows = getTodayEvents(userId);
    return `Here's your schedule today:\n${formatEvents(rows)}`;
  }
  if (op === 'day') {
    let ymd = normalizeOccurredOn(parsed.on_date) || normalizeOccurredOn(parsed.day);
    if (!ymd) {
      const d = new Date(String(parsed.starts_at || '').trim());
      if (!Number.isNaN(d.getTime())) {
        ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`;
      }
    }
    if (ymd) {
      const rows = getEventsForLocalDate(userId, ymd);
      const head =
        rows.length === 0
          ? `No calendar events on ${ymd}.`
          : `Here's your schedule for ${ymd}:`;
      const body = rows.length ? `\n${formatEvents(rows)}` : '';
      return `${head}${body}`;
    }
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
    if (!isExplicitSavedTableListRequest(userText)) {
      return null;
    }
    const lf = String(parsed.list_filter || parsed.record_type || '').toLowerCase();
    const filter = lf === 'purchase' || lf === 'medicine' || lf === 'sale' ? lf : null;
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
    if (!['purchase', 'medicine', 'other', 'sale'].includes(rt)) rt = 'other';
    if (rt === 'purchase' && /\b(sold|sell|sold off|used up|shipped out|removed from stock|deduct(ed)?)\b/i.test(userText)) {
      rt = 'sale';
    }
    let occurredOn = normalizeOccurredOn(parsed.occurred_on);
    if (!occurredOn && (rt === 'purchase' || rt === 'sale')) occurredOn = ck.localDateYmd;
    const schedule = String(parsed.schedule || '').trim().slice(0, 500);
    const notes = String(parsed.notes || '').trim().slice(0, 2000);
    const meta = {};
    if (rt === 'medicine' && schedule) meta.schedule = schedule;
    let qRaw = parsed.quantity != null ? Number(parsed.quantity) : null;
    if (!Number.isFinite(qRaw)) qRaw = null;
    const qu = parsed.quantity_unit != null ? String(parsed.quantity_unit).trim().slice(0, 40) : '';
    if (rt === 'sale' && qRaw == null) {
      const m = userText.match(/\b(?:sold|sell|sold\s+off)\s+(\d{1,9})\b/i);
      if (m) qRaw = Number(m[1]);
    }
    if (Number.isFinite(qRaw) && qRaw !== 0) {
      if (rt === 'sale') {
        meta.quantity = -Math.abs(qRaw);
        meta.movement = 'sale';
        if (qu) meta.quantity_unit = qu;
      } else if (rt === 'purchase') {
        meta.quantity = Math.abs(qRaw);
        if (qu) meta.quantity_unit = qu;
      }
    } else if (rt === 'sale') {
      meta.movement = 'sale';
    }
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
      const qtyHint =
        row.record_type === 'sale' && row.meta
          ? (() => {
              try {
                const o = JSON.parse(row.meta);
                return Number.isFinite(o.quantity) ? ` · qty ${o.quantity}` : '';
              } catch {
                return '';
              }
            })()
          : '';
      return `Saved to your table as #${row.id}: ${row.record_type} "${row.title}"${when}${price}${qtyHint}. For inventory, ask "how many X" — sales are stored as negative quantity.`;
    } catch (e) {
      return `Could not save: ${e.message}`;
    }
  }

  if (!isExplicitSavedTableListRequest(userText)) {
    return null;
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

  if ((intent === 'CHAT' || intent === 'NOTEBOOK') && shouldTryBulkImport(trimmed)) {
    const bulkReply = await tryBulkSavePurchases(userId, trimmed);
    if (bulkReply) return { reply: bulkReply };
  }

  if (intent === 'NOTEBOOK') {
    try {
      const reply = await handleNotebook(userId, trimmed);
      if (reply == null) {
        try {
          const chatReply = await chat(buildMessages(userId, trimmed), { timeoutMs: 120000 });
          return { reply: chatReply || '(empty model response)' };
        } catch (e) {
          logger.error(`Chat error (notebook→chat): ${e.message}`);
          return { reply: `Model error: ${e.message}` };
        }
      }
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
