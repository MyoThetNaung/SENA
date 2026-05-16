import { getConfig, isLlamaServerRemote } from '../config.js';

/**
 * Headers for llama.cpp server OpenAI-compatible API (optional Bearer on remote hosts).
 * @param {ReturnType<typeof getConfig>} [cfg]
 * @param {{ apiKey?: string }} [overrides]
 */
export function llamaServerAuthHeaders(cfg = getConfig(), overrides = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const key = String(overrides.apiKey ?? cfg.llamaServerApiKey ?? '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {ReturnType<typeof getConfig>} [cfg]
 * @param {{ apiKey?: string }} [overrides]
 */
export async function fetchLlamaServer(url, init = {}, cfg = getConfig(), overrides = {}) {
  const headers = { ...llamaServerAuthHeaders(cfg, overrides), ...(init.headers || {}) };
  return fetch(url, { ...init, headers });
}

export { isLlamaServerRemote };
