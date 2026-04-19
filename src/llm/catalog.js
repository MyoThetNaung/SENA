import fs from 'fs';
import net from 'net';
import path from 'path';
import { getConfig } from '../config.js';
import { explainFetchError } from './fetchUtil.js';
import { logger } from '../logger.js';

async function safeJson(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Ollama: GET /api/tags */
export async function fetchOllamaModelNames(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return { ok: false, models: [], error: 'No base URL' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const j = await safeJson(res);
    const names = (j?.models || []).map((m) => m.name).filter(Boolean);
    return { ok: true, models: names, raw: j };
  } catch (e) {
    const detail = explainFetchError(e, `${base}/api/tags`, 'Ollama');
    logger.debug(detail);
    return { ok: false, models: [], error: detail };
  } finally {
    clearTimeout(to);
  }
}

/** TCP connect to host:port from an http(s) base URL — fallback when HTTP probes behave oddly. */
function probeLlamaTcpPort(baseUrl, timeoutMs = 2000) {
  let u;
  try {
    const raw = String(baseUrl || '').trim();
    u = new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `http://${raw}`);
  } catch {
    return Promise.resolve(false);
  }
  const host = u.hostname || '127.0.0.1';
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!Number.isFinite(port) || port <= 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    const to = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('error', () => {
      clearTimeout(to);
      resolve(false);
    });
    socket.on('connect', () => clearTimeout(to));
  });
}

/**
 * Quick reachability for llama.cpp server (dashboard / bot checks).
 * Any HTTP response (including 401/404) means the server process is answering; builds differ on paths.
 * If every GET fails at the network layer, we fall back to a TCP open on the configured port.
 */
export async function probeLlamaServerReachable(baseUrl, timeoutMs = 3000) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return false;

  const endpoints = [
    `${base}/v1/models`,
    `${base}/models`,
    `${base}/health`,
    `${base}/v1/health`,
    `${base}/`,
  ];

  for (const endpoint of endpoints) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, { signal: ctrl.signal, method: 'GET' });
      if (res.body) {
        await res.body.cancel().catch(() => {});
      }
      return true;
    } catch {
      /* try next route */
    } finally {
      clearTimeout(t);
    }
  }

  const tcpOk = await probeLlamaTcpPort(base, Math.min(timeoutMs, 2500));
  if (tcpOk) {
    logger.debug(`llama-server: HTTP probe had no usable response; TCP port open for ${base} — treating as reachable`);
  }
  return tcpOk;
}

/** llama.cpp server: try OpenAI-style /v1/models, then /models */
export async function fetchLlamaServerModelNames(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return { ok: false, models: [], error: 'No base URL' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  const endpoints = [`${base}/v1/models`, `${base}/models`];
  let lastDetail = '';

  try {
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { signal: ctrl.signal });
        if (!res.ok) {
          lastDetail = `HTTP ${res.status} from ${endpoint}`;
          continue;
        }
        const j = await safeJson(res);
        const data = j?.data || j?.models || j;
        const arr = Array.isArray(data) ? data : data?.models;
        const names = Array.isArray(arr)
          ? arr.map((x) => (typeof x === 'string' ? x : x?.id || x?.name || x?.model)).filter(Boolean)
          : [];
        if (names.length) {
          return { ok: true, models: [...new Set(names)], raw: j };
        }
        lastDetail = `Empty model list from ${endpoint}`;
      } catch (e) {
        lastDetail = explainFetchError(e, endpoint, 'llama-server');
      }
    }
    logger.debug(`llama-server model list: ${lastDetail || 'no models'}`);
    return {
      ok: false,
      models: [],
      error: lastDetail || 'Could not list models (server may not expose /v1/models — pick GGUF name manually).',
    };
  } finally {
    clearTimeout(to);
  }
}

/** Combined catalog for Control Panel dropdown. */
export async function buildModelCatalog() {
  const c = getConfig();
  const gguf = [];
  try {
    const dir = c.modelsDir;
    if (fs.existsSync(dir)) {
      for (const n of fs.readdirSync(dir)) {
        if (n.toLowerCase().endsWith('.gguf')) {
          const full = path.join(dir, n);
          let st = null;
          try {
            st = fs.statSync(full);
          } catch {
            /* ignore */
          }
          gguf.push({
            id: n.replace(/\.gguf$/i, ''),
            fileName: n,
            source: 'gguf',
            sizeBytes: st ? st.size : 0,
            modified: st ? st.mtime.toISOString() : null,
          });
        }
      }
    }
  } catch (e) {
    logger.warn(`GGUF scan: ${e.message}`);
  }

  let remote = { ok: false, models: [], error: null };
  if (c.llmProvider === 'llama-server') {
    remote = await fetchLlamaServerModelNames(c.llamaServerUrl);
  } else {
    remote = await fetchOllamaModelNames(c.ollamaBaseUrl);
  }

  const seen = new Set();
  const combined = [];
  for (const m of remote.models || []) {
    if (!seen.has(m)) {
      seen.add(m);
      combined.push({ id: m, source: 'remote', label: m });
    }
  }
  for (const g of gguf) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      combined.push({ id: g.id, source: 'gguf', label: `${g.id} (.gguf)` });
    }
  }

  return {
    provider: c.llmProvider,
    ollamaBaseUrl: c.ollamaBaseUrl,
    llamaServerUrl: c.llamaServerUrl,
    engineDir: c.engineDir,
    selectedModel: c.llmModel,
    remoteOk: remote.ok,
    remoteError: remote.error,
    remoteModels: remote.models,
    ggufFiles: gguf,
    options: combined,
  };
}
