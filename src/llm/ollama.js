import { getConfig } from '../config.js';
import { explainFetchError } from './fetchUtil.js';
import { logger } from '../logger.js';
import { startLlamaServerIfConfigured } from './llamaProcess.js';
import { recordLlmUsage } from './tokenUsage.js';
import { getCalendarClockContext } from '../calendar/resolveStartsAt.js';

const BASE_SYSTEM = `You are SENA (Smart Engine for Notes & Action) AI Assistant — a private, local assistant.
You must be helpful, concise, and accurate.

Use tools when needed.
Do not hallucinate.
Ask for confirmation before performing actions.`;

/** Stops generation at end-of-turn for ChatML / Gemma-style templates (llama-server often needs these). */
const CHAT_TEMPLATE_STOP_SEQUENCES = [
  '<|im_end|>',
  '<|redacted_im_end|>',
  '<|im_start|>',
  '<|redacted_im_start|>',
  '<|endoftext|>',
  '<|eot_id|>',
  '<|end_of_turn|>',
  '</s>',
];

/**
 * Models sometimes emit the next turn's template tokens; cut those off before showing the user.
 */
export function sanitizeChatCompletionText(text) {
  if (typeof text !== 'string') return '';
  let s = text;
  const truncateBefore = ['<|im_start|>', '<|redacted_im_start|>'];
  for (const m of truncateBefore) {
    const i = s.indexOf(m);
    if (i !== -1) s = s.slice(0, i);
  }
  s = s.replace(/<\|(?:redacted_)?im_end\|>/gi, '');
  s = s.replace(/<\|eot_id\|>/g, '');
  s = s.replace(/<\|endoftext\|>/gi, '');
  return s.trim();
}

function formatBotPersonaBlock() {
  const p = getConfig().botPersona || {};
  const lines = [];
  if (p.displayName) lines.push(`Assistant name: ${p.displayName}`);
  if (p.role) lines.push(`Role / what you do: ${p.role}`);
  if (p.gender) lines.push(`Persona gender (for tone): ${p.gender}`);
  if (p.style) lines.push(`Reply style: ${p.style}`);
  if (p.addressUserEn) lines.push(`Address the user in English as: ${p.addressUserEn}`);
  if (p.addressUserMy) lines.push(`Address the user in Myanmar (Burmese) as: ${p.addressUserMy}`);
  return lines.join('\n');
}

export function baseSystemPrompt() {
  const persona = formatBotPersonaBlock();
  let s = BASE_SYSTEM;
  if (persona) s += `\n\n---\n${persona}`;
  return s;
}

function activeModel(options) {
  return options.model || getConfig().llmModel;
}

/** ~4 chars/token (rough); used only when llama-server omits `usage` in JSON. */
function roughTokenEstimate(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

function sumPromptTokensFromMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c === 'string') n += roughTokenEstimate(c);
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part.text === 'string') n += roughTokenEstimate(part.text);
      }
    }
  }
  return n;
}

/**
 * llama-server returns OpenAI-style `usage`: prompt_tokens, completion_tokens, total_tokens.
 * Some builds omit or zero fields — split total_tokens or fall back to rough estimates so metrics still work.
 */
function extractOpenAiStyleUsage(data, messages, rawAssistantContent) {
  const u = data?.usage && typeof data.usage === 'object' ? data.usage : {};
  let promptTokens = Number(u.prompt_tokens);
  let completionTokens = Number(u.completion_tokens);
  const totalTokens = Number(u.total_tokens);
  if (!Number.isFinite(promptTokens)) promptTokens = 0;
  if (!Number.isFinite(completionTokens)) completionTokens = 0;

  if (promptTokens + completionTokens < 1 && Number.isFinite(totalTokens) && totalTokens > 0) {
    const compEst = Math.max(1, roughTokenEstimate(typeof rawAssistantContent === 'string' ? rawAssistantContent : ''));
    completionTokens = Math.min(compEst, totalTokens);
    promptTokens = totalTokens - completionTokens;
  }
  if (promptTokens + completionTokens < 1) {
    promptTokens = sumPromptTokensFromMessages(messages);
    completionTokens = roughTokenEstimate(typeof rawAssistantContent === 'string' ? rawAssistantContent : '');
    if (promptTokens + completionTokens < 1 && String(rawAssistantContent || '').length > 0) {
      completionTokens = 1;
    }
    logger.debug(
      'llama-server: usage missing or zero in JSON — using rough token estimates for dashboard metrics'
    );
  }

  return {
    promptTokens: Math.max(0, Math.floor(promptTokens)),
    completionTokens: Math.max(0, Math.floor(completionTokens)),
  };
}

function ollamaHttpError(status, errText) {
  const slice = errText.slice(0, 400);
  let msg = `Ollama HTTP ${status}: ${slice}`;
  if (status === 404 && /model/i.test(slice) && /not found/i.test(slice)) {
    msg +=
      ' — No model with that name is installed in Ollama. Run `ollama list` to see names, or `ollama pull llama3.2` (etc.). If you use a GGUF file, create a model: `ollama create MyName -f Modelfile` then set Active model to MyName in the Control Panel.';
  }
  return new Error(msg);
}

async function ollamaFetch(path, body, timeoutMs) {
  const url = `${getConfig().ollamaBaseUrl}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw ollamaHttpError(res.status, errText);
    }
    return res.json();
  } catch (e) {
    if (e?.message?.startsWith?.('Ollama HTTP')) throw e;
    throw new Error(explainFetchError(e, url, 'Ollama'));
  } finally {
    clearTimeout(t);
  }
}

/** llama.cpp server — OpenAI-compatible chat completions (with usage + timing for metrics). */
async function llamaServerChatWithUsage(messages, options = {}) {
  const base = getConfig().llamaServerUrl.replace(/\/$/, '');
  const url = `${base}/v1/chat/completions`;
  const model = activeModel(options);
  const timeoutMs = options.timeoutMs ?? 120000;
  const body = {
    model,
    messages,
    stream: false,
    stop: Array.isArray(options.stop) && options.stop.length ? options.stop : CHAT_TEMPLATE_STOP_SEQUENCES,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const errText = await res.text();
    const durationMs = Date.now() - t0;
    if (!res.ok) {
      throw new Error(`llama-server HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    let data;
    try {
      data = JSON.parse(errText);
    } catch {
      throw new Error('llama-server: invalid JSON response');
    }
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') {
      logger.warn('Unexpected llama-server response shape');
      return { text: '', promptTokens: 0, completionTokens: 0, durationMs };
    }
    const { promptTokens, completionTokens } = extractOpenAiStyleUsage(data, messages, raw);
    return { text: sanitizeChatCompletionText(raw), promptTokens, completionTokens, durationMs };
  } catch (e) {
    if (String(e?.message || '').startsWith('llama-server HTTP')) throw e;
    if (String(e?.message || '').includes('invalid JSON')) throw e;
    throw new Error(explainFetchError(e, url, 'llama-server'));
  } finally {
    clearTimeout(t);
  }
}

/**
 * Non-streaming chat completion (Ollama or llama.cpp server).
 */
export async function chat(messages, options = {}) {
  const model = activeModel(options);
  if (getConfig().llmProvider === 'llama-server') {
    const llama = await startLlamaServerIfConfigured(true);
    if (!llama.ok) {
      throw new Error(
        llama.error ||
          'llama-server could not start or switch to the GGUF for the active model. Save settings, then try again.'
      );
    }
    const r = await llamaServerChatWithUsage(messages, options);
    recordLlmUsage({
      provider: 'llama-server',
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
    });
    return r.text;
  }

  const timeoutMs = options.timeoutMs ?? 120000;
  const chatOptions = {
    stop: CHAT_TEMPLATE_STOP_SEQUENCES,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
  const t0 = Date.now();
  const data = await ollamaFetch(
    '/api/chat',
    {
      model,
      messages,
      stream: false,
      options: chatOptions,
    },
    timeoutMs
  );
  const durationMs = Date.now() - t0;
  const promptTokens = Number(data.prompt_eval_count) || 0;
  const completionTokens = Number(data.eval_count) || 0;
  recordLlmUsage({
    provider: 'ollama',
    model,
    promptTokens,
    completionTokens,
    durationMs,
  });
  const text = data?.message?.content;
  if (typeof text !== 'string') {
    logger.warn('Unexpected Ollama chat response shape');
    return '';
  }
  return sanitizeChatCompletionText(text);
}

/**
 * Streaming chat — Ollama only (llama-server stream format differs).
 */
export async function* chatStream(messages, options = {}) {
  if (getConfig().llmProvider === 'llama-server') {
    throw new Error('Streaming is only implemented for Ollama; use non-stream chat with llama-server.');
  }
  const model = activeModel(options);
  const timeoutMs = options.timeoutMs ?? 120000;
  const url = `${getConfig().ollamaBaseUrl}/api/chat`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama stream HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body for stream');
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let j;
      try {
        j = JSON.parse(s);
      } catch {
        continue;
      }
      const piece = j?.message?.content;
      if (typeof piece === 'string' && piece) yield piece;
    }
  }
}

export async function classifyIntent(userMessage) {
  const text = await chat(
    [
      {
        role: 'system',
        content:
          'Classify the user message into exactly one word: CHAT, SEARCH, or CALENDAR.\n' +
          '- CHAT: conversation, advice, coding help, opinions, no live web or schedule needed.\n' +
          '- SEARCH: user needs current/public web information, news, prices, facts from the internet.\n' +
          '- CALENDAR: scheduling, events, reminders, or asking what is on their schedule.\n' +
          'Reply with only one word.',
      },
      { role: 'user', content: userMessage.slice(0, 2000) },
    ],
    { timeoutMs: 45000, temperature: 0 }
  );
  const u = text.toUpperCase();
  if (u.includes('SEARCH')) return 'SEARCH';
  if (u.includes('CALENDAR')) return 'CALENDAR';
  return 'CHAT';
}

export async function parseCalendarRequest(userMessage) {
  const ck = getCalendarClockContext();
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          'You extract calendar intent from the user message. Reply with JSON only, no markdown.\n' +
          `The user's computer clock (authoritative for "today", "tomorrow", etc.): ISO ${ck.iso}; local: ${ck.localLong}; timezone: ${ck.tz}; local calendar date: ${ck.localDateYmd}.\n` +
          'Schema: {"op":"add"|"today"|"upcoming","title":"","starts_at":""}\n' +
          '- op "add": set title and starts_at as a valid ISO 8601 string (UTC or offset) for the event start.\n' +
          '- Compute "tomorrow", "today", "next Monday" from the clock above (same timezone as the user\'s PC).\n' +
          '- If no time is given, use 09:00 local for that day for meetings/reminders unless the user implies evening.\n' +
          '- op "today": user asks about today schedule.\n' +
          '- op "upcoming": user asks upcoming schedule (default next 10).\n',
      },
      { role: 'user', content: userMessage.slice(0, 2000) },
    ],
    { timeoutMs: 60000, temperature: 0 }
  );
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    logger.warn(`parseCalendarRequest JSON fail: ${e.message}`);
    return { op: 'upcoming', title: '', starts_at: '' };
  }
}

export async function summarizeWebContent(query, pageTexts) {
  const combined = pageTexts
    .map((t, i) => `--- Source ${i + 1} ---\n${t.slice(0, 12000)}`)
    .join('\n\n');
  return chat(
    [
      {
        role: 'system',
        content:
          'Summarize the following web excerpts for the user query. Be concise and factual. ' +
          'If content is missing or irrelevant, say so. No bullet spam.',
      },
      {
        role: 'user',
        content: `Query: ${query}\n\n${combined}`.slice(0, 28000),
      },
    ],
    { timeoutMs: 120000, temperature: 0.2 }
  );
}
