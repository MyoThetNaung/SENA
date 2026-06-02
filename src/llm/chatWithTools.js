import { getConfig } from "../config.js";
import { fetchLlamaServer } from "./llamaServerClient.js";
import { explainFetchError } from "./fetchUtil.js";
import { ensureLlamaServerReachable } from "./llamaProcess.js";
import { recordLlmUsage } from "./tokenUsage.js";
import {
  sanitizeChatCompletionText,
  CHAT_TEMPLATE_STOP_SEQUENCES,
} from "./sanitizeCompletion.js";
import { logger } from "../logger.js";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";

/** @returns {boolean} */
export function providerSupportsTools() {
  const p = getConfig().llmProvider;
  return p === "llama-server" || p === "openai" || p === "openrouter" || p === "ollama";
}

function activeModel(options) {
  return options.model || getConfig().llmModel;
}

function normalizeMessages(messages) {
  return messages.map((m) => {
    const base = { role: m.role };
    if (m.role === "tool") {
      base.tool_call_id = m.tool_call_id;
      base.content =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content ?? "");
      return base;
    }
    if (m.tool_calls) base.tool_calls = m.tool_calls;
    if (typeof m.content === "string" || m.content == null) {
      base.content = m.content ?? "";
    } else {
      base.content = m.content;
    }
    return base;
  });
}

function parseAssistantMessage(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) {
    return { role: "assistant", content: "", tool_calls: undefined };
  }
  const toolCalls =
    Array.isArray(msg.tool_calls) && msg.tool_calls.length
      ? msg.tool_calls
      : undefined;
  const content =
    typeof msg.content === "string"
      ? sanitizeChatCompletionText(msg.content)
      : "";
  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls,
  };
}

function extractUsage(data, messages, rawContent) {
  const u = data?.usage && typeof data.usage === "object" ? data.usage : {};
  let promptTokens = Math.max(0, Math.floor(Number(u.prompt_tokens) || 0));
  let completionTokens = Math.max(
    0,
    Math.floor(Number(u.completion_tokens) || 0),
  );
  if (promptTokens + completionTokens < 1) {
    const total = Number(u.total_tokens);
    if (Number.isFinite(total) && total > 0) {
      completionTokens = Math.min(total, 1);
      promptTokens = total - completionTokens;
    }
  }
  if (promptTokens + completionTokens < 1 && typeof rawContent === "string") {
    logger.debug("chatWithTools: usage missing in response");
  }
  return { promptTokens, completionTokens };
}

async function openAiCompatibleChatWithTools(
  url,
  apiKey,
  messages,
  tools,
  options = {},
  providerName = "Provider",
) {
  const model = String(activeModel(options) || "").trim();
  if (!model) throw new Error(`No ${providerName} model selected.`);
  const key = String(apiKey || "").trim();
  if (!key) throw new Error(`${providerName} API key is missing.`);

  const timeoutMs = options.timeoutMs ?? 120000;
  const body = {
    model,
    messages: normalizeMessages(messages),
    tools,
    tool_choice: options.tool_choice ?? "auto",
    stream: false,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (Array.isArray(options.stop) && options.stop.length)
    body.stop = options.stop;
  else if (getConfig().llmProvider === "llama-server")
    body.stop = CHAT_TEMPLATE_STOP_SEQUENCES;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const rawText = await res.text();
    const durationMs = Date.now() - t0;
    if (!res.ok) {
      throw new Error(
        `${providerName} chat HTTP ${res.status}: ${rawText.slice(0, 400)}`,
      );
    }
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`${providerName} chat: invalid JSON`);
    }
    const message = parseAssistantMessage(data);
    const usage = extractUsage(data, messages, message.content);
    return { message, ...usage, durationMs };
  } catch (e) {
    if (String(e?.message || "").startsWith(`${providerName} chat HTTP`))
      throw e;
    throw new Error(explainFetchError(e, url, providerName));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat completion with OpenAI-style tools.
 * @param {object[]} messages
 * @param {object[]} tools OpenAI tool definitions
 * @param {{ model?: string, timeoutMs?: number, temperature?: number, soulUserId?: number }} [options]
 */
export async function chatWithTools(messages, tools, options = {}) {
  const cfg = getConfig();
  const provider = cfg.llmProvider;
  const model = activeModel(options);
  const soulUserId =
    options.soulUserId != null && Number.isFinite(Number(options.soulUserId))
      ? Number(options.soulUserId)
      : null;

  if (!providerSupportsTools()) {
    throw new Error(
      `LLM provider "${provider}" does not support tool calling in this build.`,
    );
  }

  let result;
  if (provider === "openai") {
    const url = OPENAI_CHAT_URL;
    const r = await openAiCompatibleChatWithTools(
      url,
      cfg.openaiApiKey,
      messages,
      tools,
      options,
      "OpenAI",
    );
    result = r;
    void recordLlmUsage({
      provider: "openai",
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
      soulUserId,
    });
  } else if (provider === "openrouter") {
    const base = String(
      cfg.openrouterBaseUrl || OPENROUTER_DEFAULT_BASE,
    ).replace(/\/$/, "");
    const r = await openAiCompatibleChatWithTools(
      `${base}/chat/completions`,
      cfg.openrouterApiKey,
      messages,
      tools,
      options,
      "OpenRouter",
    );
    result = r;
    void recordLlmUsage({
      provider: "openrouter",
      model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      durationMs: r.durationMs,
      soulUserId,
    });
  } else if (provider === "llama-server") {
    const reach = await ensureLlamaServerReachable();
    if (!reach.ok) throw new Error(reach.error);
    const base = cfg.llamaServerUrl.replace(/\/$/, "");
    const url = `${base}/v1/chat/completions`;
    const timeoutMs = options.timeoutMs ?? 120000;
    const body = {
      model,
      messages: normalizeMessages(messages),
      tools,
      tool_choice: options.tool_choice ?? "auto",
      stream: false,
      stop:
        Array.isArray(options.stop) && options.stop.length
          ? options.stop
          : CHAT_TEMPLATE_STOP_SEQUENCES,
    };
    if (options.temperature !== undefined)
      body.temperature = options.temperature;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetchLlamaServer(url, {
        method: "POST",
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const rawText = await res.text();
      const durationMs = Date.now() - t0;
      if (!res.ok) {
        throw new Error(
          `llama-server HTTP ${res.status}: ${rawText.slice(0, 300)}`,
        );
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error("llama-server: invalid JSON response");
      }
      const message = parseAssistantMessage(data);
      const usage = extractUsage(data, messages, message.content);
      result = { message, ...usage, durationMs };
      void recordLlmUsage({
        provider: "llama-server",
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        durationMs,
        soulUserId,
      });
    } catch (e) {
      if (String(e?.message || "").startsWith("llama-server HTTP")) throw e;
      throw new Error(explainFetchError(e, url, "llama-server"));
    } finally {
      clearTimeout(t);
    }
  } else if (provider === "ollama") {
    const base = cfg.ollamaBaseUrl.replace(/\/$/, "");
    const url = `${base}/api/chat`;
    const timeoutMs = options.timeoutMs ?? 120000;
    const body = {
      model,
      messages: normalizeMessages(messages),
      tools,
      stream: false,
    };
    if (options.temperature !== undefined) body.options = { temperature: options.temperature };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const rawText = await res.text();
      const durationMs = Date.now() - t0;
      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${rawText.slice(0, 300)}`);
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error("Ollama: invalid JSON response");
      }
      const msg = data?.message || {};
      const toolCalls =
        Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : undefined;
      const message = {
        role: "assistant",
        content:
          typeof msg.content === "string" ? sanitizeChatCompletionText(msg.content) : null,
        tool_calls: toolCalls,
      };
      const usage = extractUsage(data, messages, message.content);
      result = { message, ...usage, durationMs };
      void recordLlmUsage({
        provider: "ollama",
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        durationMs,
        soulUserId,
      });
    } catch (e) {
      if (String(e?.message || "").startsWith("Ollama HTTP")) throw e;
      throw new Error(explainFetchError(e, url, "Ollama"));
    } finally {
      clearTimeout(t);
    }
  } else {
    throw new Error(`Unsupported provider for tools: ${provider}`);
  }

  return result;
}
