import { getConfig } from '../config.js';
import { getBotIdForScopedUserId } from '../access/telegramAccess.js';
import { getSoul } from '../memory/soul.js';
import { explainFetchError } from './fetchUtil.js';
import { logger } from '../logger.js';
import { startLlamaServerIfConfigured } from './llamaProcess.js';
import { recordLlmUsage } from './tokenUsage.js';
import { getCalendarClockContext } from '../calendar/resolveStartsAt.js';
import { sanitizeChatCompletionText, CHAT_TEMPLATE_STOP_SEQUENCES } from './sanitizeCompletion.js';
import {
  openaiChatWithUsage,
  openaiChatStream,
  openrouterChatWithUsage,
  openrouterChatStream,
  geminiChatWithUsage,
  openAiCompatibleChatStream,
} from './cloudLlm.js';

export { sanitizeChatCompletionText };

const BASE_SYSTEM = `You are SENA (Smart Engine for Notes & Action) AI Assistant — a private assistant (local or cloud LLM per user settings).
You must be helpful, concise, and accurate.

Use tools when needed.
Do not hallucinate.
Ask for confirmation before performing actions.`;

function mergeBotPersonaForUserId(userId) {
  const cfg = getConfig();
  const botId = getBotIdForScopedUserId(userId);
  const globalByBot =
    botId != null && cfg.botPersonaByBotId && typeof cfg.botPersonaByBotId === 'object'
      ? cfg.botPersonaByBotId[String(botId)] || {}
      : {};
  const global = Object.keys(globalByBot).length ? globalByBot : cfg.botPersona || {};
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return { ...global };
  const soul = getSoul(uid);
  const raw = soul.preferences?.botPersona;
  const local = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const keys = ['displayName', 'displayNameMy', 'gender', 'style', 'role', 'addressUserEn', 'addressUserMy'];
  const out = { ...global };
  for (const k of keys) {
    const v = local[k];
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  const prof =
    soul.preferences?.profile && typeof soul.preferences.profile === 'object' ? soul.preferences.profile : {};
  if (typeof prof.addressUserEn === 'string' && prof.addressUserEn.trim() !== '') {
    out.addressUserEn = prof.addressUserEn.trim();
  }
  if (typeof prof.addressUserMy === 'string' && prof.addressUserMy.trim() !== '') {
    out.addressUserMy = prof.addressUserMy.trim();
  }
  return out;
}

function formatBotPersonaBlock(persona) {
  const p = persona || {};
  const lines = [];
  if (p.displayName) lines.push(`Assistant name: ${p.displayName}`);
  if (p.displayNameMy) lines.push(`Assistant name (Myanmar): ${p.displayNameMy}`);
  if (p.role) lines.push(`Role / what you do: ${p.role}`);
  if (p.gender) lines.push(`Persona gender (for tone): ${p.gender}`);
  if (p.style) lines.push(`Reply style: ${p.style}`);
  if (p.addressUserEn) lines.push(`Address the user in English as: ${p.addressUserEn}`);
  if (p.addressUserMy) lines.push(`Address the user in Myanmar (Burmese) as: ${p.addressUserMy}`);
  return lines.join('\n');
}

const RUNTIME_LLM_LABELS = {
  ollama: 'Ollama (local)',
  'llama-server': 'llama.cpp server (local OpenAI-compatible API)',
  openai: 'OpenAI API (cloud)',
  openrouter: 'OpenRouter API (cloud)',
  gemini: 'Google Gemini API (cloud)',
};

function getRuntimeLlmDescriptors() {
  const c = getConfig();
  const id = String(c.llmProvider || '').trim();
  const backendLabel = RUNTIME_LLM_LABELS[id] || id || 'unknown';
  const modelId = String(c.llmModel || '').trim() || '(not set)';
  return { backendLabel, modelId, providerId: id };
}

/** Reply built only from app settings — use when the local LLM might hallucinate (e.g. Gemma → “Gemini”). */
export function deterministicRuntimeIdentityReply() {
  const { backendLabel, modelId } = getRuntimeLlmDescriptors();
  return (
    `Configured in SENA (from your settings — not guessed by the model):\n` +
    `• LLM backend: ${backendLabel}\n` +
    `• Active model: ${modelId}`
  );
}

/** Facts about the configured LLM so the model does not guess (e.g. wrong vendor name). */
function runtimeLlmIdentityBlock() {
  const { backendLabel, modelId } = getRuntimeLlmDescriptors();
  return (
    '\n\n---\nRuntime LLM (authoritative — when the user asks which model, AI engine, or backend you use, answer only from this block):\n' +
    `- Backend: ${backendLabel}\n` +
    `- Active model id: ${modelId}\n` +
    'Do not invent a vendor or model name. You may briefly explain what the active model id refers to if the user asks.'
  );
}

/** @param {number} [userId] Chat / Telegram user id — per-soul bot persona overrides global settings when set. */
export function baseSystemPrompt(userId) {
  const persona = formatBotPersonaBlock(mergeBotPersonaForUserId(userId));
  let s = BASE_SYSTEM;
  if (persona) s += `\n\n---\n${persona}`;
  s += runtimeLlmIdentityBlock();
  if (!getConfig().webSearchEnabled) {
    s +=
      '\n\nYou do not have live web search. Answer from this conversation, user memory, and general knowledge; ' +
      'if the user needs current online facts, say web search is turned off and give the best non-live answer you can.';
  }
  return s;
}

function activeModel(options) {
  return options.model || getConfig().llmModel;
}

/**
 * Smarter token estimate when providers omit usage data.
 * English/mixed text ~4 chars/token; CJK scripts ~1.5 chars/token;
 * code ~3 chars/token; whitespace-heavy content is discounted.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  let tokens = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (cp >= 0x4e00 && cp <= 0x9fff) {
      tokens += 1;
      i += cp > 0xffff ? 2 : 1;
    } else if (cp >= 0x3040 && cp <= 0x30ff) {
      tokens += 1;
      i += cp > 0xffff ? 2 : 1;
    } else if (cp >= 0xac00 && cp <= 0xd7af) {
      tokens += 1;
      i += cp > 0xffff ? 2 : 1;
    } else {
      tokens += 0.25;
      i += 1;
    }
  }
  return Math.max(0, Math.ceil(tokens));
}

function sumPromptTokensFromMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c === 'string') n += estimateTokens(c);
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part.text === 'string') n += estimateTokens(part.text);
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
    const compEst = Math.max(1, estimateTokens(typeof rawAssistantContent === 'string' ? rawAssistantContent : ''));
    completionTokens = Math.min(compEst, totalTokens);
    promptTokens = totalTokens - completionTokens;
  }
  if (promptTokens + completionTokens < 1) {
    promptTokens = sumPromptTokensFromMessages(messages);
    completionTokens = estimateTokens(typeof rawAssistantContent === 'string' ? rawAssistantContent : '');
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
  const provider = getConfig().llmProvider;

  if (provider === 'openai') {
    const r = await openaiChatWithUsage(messages, options);
    recordLlmUsage({
      provider: 'openai',
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
    });
    return r.text;
  }
  if (provider === 'openrouter') {
    const r = await openrouterChatWithUsage(messages, options);
    recordLlmUsage({
      provider: 'openrouter',
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
    });
    return r.text;
  }
  if (provider === 'gemini') {
    const r = await geminiChatWithUsage(messages, options);
    recordLlmUsage({
      provider: 'gemini',
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
    });
    return r.text;
  }

  if (provider === 'llama-server') {
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
 * Streaming chat — yields text deltas as they arrive.
 * Supports Ollama, llama-server (OpenAI-compatible SSE), and OpenAI cloud.
 */
export async function* chatStream(messages, options = {}) {
  const config = getConfig();
  const provider = config.llmProvider;
  const model = activeModel(options);
  const timeoutMs = options.timeoutMs ?? 120000;
  const stop = Array.isArray(options.stop) && options.stop.length ? options.stop : CHAT_TEMPLATE_STOP_SEQUENCES;

  if (provider === 'llama-server') {
    yield* llamaServerChatStream(messages, { ...options, model, timeoutMs, stop });
    return;
  }

  if (provider === 'openai') {
    yield* openaiChatStream(messages, { ...options, model, timeoutMs, stop });
    return;
  }
  if (provider === 'openrouter') {
    yield* openrouterChatStream(messages, { ...options, model, timeoutMs, stop });
    return;
  }

  if (provider === 'gemini') {
    yield* geminiChatStream(messages, { ...options, model, timeoutMs });
    return;
  }

  const url = `${config.ollamaBaseUrl}/api/chat`;
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

async function* llamaServerChatStream(messages, options = {}) {
  const base = getConfig().llamaServerUrl.replace(/\/$/, '');
  const url = `${base}/v1/chat/completions`;
  const body = {
    model: options.model || getConfig().llmModel,
    messages,
    stream: true,
    stop: options.stop || CHAT_TEMPLATE_STOP_SEQUENCES,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  yield* openAiCompatibleChatStream(url, body, {
    headers: {},
    timeoutMs: options.timeoutMs ?? 120000,
  });
}

/** Build Gemini streamGenerateContent URL and stream chunks. */
async function* geminiChatStream(messages, options = {}) {
  const c = getConfig();
  const key = String(c.geminiApiKey || '').trim();
  if (!key) throw new Error('Gemini API key is missing.');
  let modelId = String(options.model || c.llmModel || '').trim().replace(/^models\//, '');
  if (!modelId) throw new Error('No Gemini model selected.');
  const { systemInstruction, contents } = buildGeminiStreamContents(messages);
  const streamUrl = `${GEMINI_BASE}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (options.temperature !== undefined) {
    body.generationConfig = { temperature: options.temperature };
  }
  const timeoutMs = options.timeoutMs ?? 120000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini stream HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body for Gemini stream');
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
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j;
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      const parts = j?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p.text === 'string' && p.text) yield p.text;
        }
      }
    }
  }
}

function buildGeminiStreamContents(messages) {
  const systemTexts = [];
  const contents = [];
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'system') {
      systemTexts.push(text);
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text }] });
  }
  const systemInstruction =
    systemTexts.length > 0 ? { parts: [{ text: systemTexts.join('\n\n') }] } : undefined;
  if (!contents.length) {
    contents.push({ role: 'user', parts: [{ text: '(empty)' }] });
  }
  if (contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '…' }] });
  }
  return { systemInstruction, contents };
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function classifyIntent(userMessage) {
  const { webSearchEnabled } = getConfig();
  const system = webSearchEnabled
    ? 'Classify the user message into exactly one word: CHAT, SEARCH, or CALENDAR.\n' +
      '- CHAT: conversation, advice, coding help, opinions, no live web or schedule needed.\n' +
      '- SEARCH: user needs current/public web information, news, prices, facts from the internet.\n' +
      '- CALENDAR: scheduling, events, reminders, or asking what is on their schedule.\n' +
      'Reply with only one word.'
    : 'Classify the user message into exactly one word: CHAT or CALENDAR.\n' +
      '- CHAT: conversation, advice, coding help, opinions, general knowledge (no live web).\n' +
      '- CALENDAR: scheduling, events, reminders, or asking what is on their schedule.\n' +
      'Reply with only one word.';
  const text = await chat(
    [{ role: 'system', content: system }, { role: 'user', content: userMessage.slice(0, 2000) }],
    { timeoutMs: 45000, temperature: 0 }
  );
  const u = text.toUpperCase();
  if (webSearchEnabled && u.includes('SEARCH')) return 'SEARCH';
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
