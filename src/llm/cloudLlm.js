import { getConfig } from '../config.js';
import { explainFetchError } from './fetchUtil.js';
import { logger } from '../logger.js';
import { sanitizeChatCompletionText } from './sanitizeCompletion.js';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function isOpenAiChatCapableModelId(id) {
  const x = String(id || '').toLowerCase();
  if (!x) return false;
  if (x.includes('embedding')) return false;
  if (x.includes('whisper')) return false;
  if (x.includes('tts')) return false;
  if (x.includes('dall-e') || x.includes('moderation')) return false;
  if (x.startsWith('text-') || x.startsWith('audio-') || x.startsWith('realtime')) return false;
  if (/^babbage|^davinci|^ada-|^curie/.test(x)) return false;
  return true;
}

/** @returns {{ ok: boolean, models: string[], error?: string }} */
export async function fetchOpenAiModelNames(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, models: [], error: 'No API key' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(OPENAI_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, models: [], error: `OpenAI HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return { ok: false, models: [], error: 'OpenAI: invalid JSON from /v1/models' };
    }
    const arr = Array.isArray(j?.data) ? j.data : [];
    const models = [...new Set(arr.map((x) => x?.id).filter(isOpenAiChatCapableModelId))].sort();
    return { ok: true, models };
  } catch (e) {
    const detail = explainFetchError(e, OPENAI_MODELS_URL, 'OpenAI');
    logger.debug(detail);
    return { ok: false, models: [], error: detail };
  } finally {
    clearTimeout(t);
  }
}

/** @returns {{ ok: boolean, models: string[], error?: string }} */
export async function fetchGeminiModelNames(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, models: [], error: 'No API key' };
  const url = `${GEMINI_BASE}/models?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, models: [], error: `Gemini HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return { ok: false, models: [], error: 'Gemini: invalid JSON from /models' };
    }
    const models = [];
    const seen = new Set();
    for (const m of j?.models || []) {
      const methods = m.supportedGenerationMethods || [];
      if (!methods.includes('generateContent')) continue;
      const raw = String(m.name || '').replace(/^models\//, '');
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      models.push(raw);
    }
    models.sort();
    return { ok: true, models };
  } catch (e) {
    const detail = explainFetchError(e, url, 'Gemini');
    logger.debug(detail);
    return { ok: false, models: [], error: detail };
  } finally {
    clearTimeout(t);
  }
}

function buildGeminiContents(messages) {
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

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {{ model?: string, timeoutMs?: number, temperature?: number }} options
 */
export async function openaiChatWithUsage(messages, options = {}) {
  const c = getConfig();
  const key = String(c.openaiApiKey || '').trim();
  if (!key) throw new Error('OpenAI API key is missing. Add it under Engine & models, then Save settings.');
  const model = String(options.model || c.llmModel || '').trim();
  if (!model) throw new Error('No OpenAI model selected.');
  const timeoutMs = options.timeoutMs ?? 120000;
  const body = {
    model,
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    })),
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const rawText = await res.text();
    const durationMs = Date.now() - t0;
    if (!res.ok) {
      throw new Error(`OpenAI chat HTTP ${res.status}: ${rawText.slice(0, 400)}`);
    }
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('OpenAI chat: invalid JSON');
    }
    const outMsg = data?.choices?.[0]?.message?.content;
    if (typeof outMsg !== 'string') {
      logger.warn('OpenAI: unexpected response shape');
      return { text: '', promptTokens: 0, completionTokens: 0, durationMs };
    }
    const u = data?.usage || {};
    const promptTokens = Math.max(0, Math.floor(Number(u.prompt_tokens) || 0));
    const completionTokens = Math.max(0, Math.floor(Number(u.completion_tokens) || 0));
    return {
      text: sanitizeChatCompletionText(outMsg),
      promptTokens,
      completionTokens,
      durationMs,
    };
  } catch (e) {
    if (String(e?.message || '').startsWith('OpenAI chat HTTP')) throw e;
    throw new Error(explainFetchError(e, OPENAI_CHAT_URL, 'OpenAI'));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {{ model?: string, timeoutMs?: number, temperature?: number }} options
 */
export async function geminiChatWithUsage(messages, options = {}) {
  const c = getConfig();
  const key = String(c.geminiApiKey || '').trim();
  if (!key) throw new Error('Gemini API key is missing. Add it under Engine & models, then Save settings.');
  let modelId = String(options.model || c.llmModel || '').trim().replace(/^models\//, '');
  if (!modelId) throw new Error('No Gemini model selected.');
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;
  const { systemInstruction, contents } = buildGeminiContents(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (options.temperature !== undefined) {
    body.generationConfig = { temperature: options.temperature };
  }

  const timeoutMs = options.timeoutMs ?? 120000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const rawText = await res.text();
    const durationMs = Date.now() - t0;
    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${rawText.slice(0, 400)}`);
    }
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error('Gemini: invalid JSON');
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    let outMsg = '';
    if (Array.isArray(parts)) {
      outMsg = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    }
    if (typeof outMsg !== 'string') outMsg = '';
    const meta = data?.usageMetadata || {};
    const promptTokens = Math.max(0, Math.floor(Number(meta.promptTokenCount) || 0));
    const completionTokens = Math.max(0, Math.floor(Number(meta.candidatesTokenCount) || 0));
    return {
      text: sanitizeChatCompletionText(outMsg),
      promptTokens,
      completionTokens,
      durationMs,
    };
  } catch (e) {
    if (String(e?.message || '').startsWith('Gemini HTTP')) throw e;
    throw new Error(explainFetchError(e, url, 'Gemini'));
  } finally {
    clearTimeout(timer);
  }
}
