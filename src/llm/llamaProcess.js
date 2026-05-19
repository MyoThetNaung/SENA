import { getConfig } from '../config.js';
import { probeLlamaServerReachable } from './catalog.js';

/** Ensure llama-server HTTP API responds (when provider is llama-server). */
export async function ensureLlamaServerReachable() {
  const c = getConfig();
  if (c.llmProvider !== 'llama-server') {
    return { ok: true };
  }
  const url = c.llamaServerUrl.replace(/\/$/, '');
  try {
    const up = await probeLlamaServerReachable(url, 3000);
    if (up) {
      return { ok: true };
    }
  } catch {
    /* fall through */
  }
  return {
    ok: false,
    error: `llama.cpp server is not reachable at ${url}. Start your server, set the base URL in Engine settings, then use Test Connection.`,
  };
}

/** Ensure Ollama HTTP API responds (when provider is ollama). */
export async function ensureOllamaReachable() {
  const c = getConfig();
  if (c.llmProvider !== 'ollama') {
    return { ok: true };
  }
  const url = c.ollamaBaseUrl.replace(/\/$/, '');
  try {
    const up = await probeLlamaServerReachable(url, 3000);
    if (up) {
      return { ok: true };
    }
  } catch {
    /* fall through */
  }
  return {
    ok: false,
    error: `Ollama is not reachable at ${url}. Start Ollama, set the base URL in Engine settings, then use Test Connection.`,
  };
}

/** Reachability for the active local LLM backend (llama-server or Ollama). */
export async function ensureLlmBackendReachable() {
  const c = getConfig();
  if (c.llmProvider === 'llama-server') return ensureLlamaServerReachable();
  if (c.llmProvider === 'ollama') return ensureOllamaReachable();
  return { ok: true };
}
