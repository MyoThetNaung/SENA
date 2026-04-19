import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';
import { probeLlamaServerReachable } from './catalog.js';

let child = null;
let weStarted = false;
/** Full path of GGUF this app loaded (llama-server only loads one model per process). */
let lastSpawnedGgufPath = null;

function resolveBinary(engineDir) {
  const win = process.platform === 'win32';
  const names = win ? ['llama-server.exe', 'llama-server'] : ['llama-server', 'llama-server.exe'];
  for (const n of names) {
    const p = path.join(engineDir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Find .gguf for Active model name (or single file in folder). */
export function resolveGgufPath(modelsDir, modelName) {
  if (!fs.existsSync(modelsDir)) return null;
  const clean = String(modelName || '').replace(/\.gguf$/i, '').trim();
  const direct = path.join(modelsDir, `${clean}.gguf`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith('.gguf'));
  const want = clean.toLowerCase();
  const hit = files.find((f) => f.replace(/\.gguf$/i, '').toLowerCase() === want);
  if (hit) return path.join(modelsDir, hit);
  if (files.length === 1) {
    logger.info(`Using only GGUF in folder: ${files[0]}`);
    return path.join(modelsDir, files[0]);
  }
  return null;
}

function parseServerUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname || '127.0.0.1';
    let port = u.port;
    if (!port) {
      port = u.protocol === 'https:' ? '443' : '80';
    }
    return { host, port: String(port) };
  } catch {
    return { host: '127.0.0.1', port: '8080' };
  }
}

function waitForTcpPort(host, port, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  const p = Number(port);
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Port ${p} did not open — llama-server may have failed to start. Check engine folder logs above.`));
        return;
      }
      const socket = net.connect({ host, port: p }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(attempt, 400);
      });
    }
    attempt();
  });
}

/**
 * If backend is llama-server and (force GUI start | auto-start flag | env), spawn engine/llama-server.exe.
 * @param {boolean} [force] When true, start whenever provider is llama-server (Control Panel "Start server").
 * Call before createBot() with force=false for normal autostart-on-bot behavior.
 */
export async function startLlamaServerIfConfigured(force = false) {
  const c = getConfig();
  if (c.llmProvider !== 'llama-server') {
    return { ok: true, skipped: true };
  }
  const wantStart =
    force ||
    c.autoStartLlamaServer === true ||
    process.env.AUTO_START_LLAMA_SERVER === '1';
  if (!wantStart) {
    return { ok: true, skipped: true };
  }

  const exe = resolveBinary(c.engineDir);
  if (!exe) {
    logger.error(
      `autoStartLlamaServer: no llama-server binary in ${c.engineDir}. Place llama-server.exe there or start the server manually.`
    );
    return { ok: false, error: 'Missing llama-server executable in engine folder' };
  }

  const gguf = resolveGgufPath(c.modelsDir, c.llmModel);
  if (!gguf) {
    logger.error(
      `autoStartLlamaServer: no matching .gguf in ${c.modelsDir} for model "${c.llmModel}". Add a file or rename Active model.`
    );
    return { ok: false, error: 'No GGUF file found for the selected model' };
  }

  const { host, port } = parseServerUrl(c.llamaServerUrl);
  const url = c.llamaServerUrl.replace(/\/$/, '');

  if (child && weStarted) {
    if (lastSpawnedGgufPath === gguf) {
      logger.info(`llama-server already running with selected model (${path.basename(gguf)})`);
      return { ok: true, skipped: false };
    }
    logger.info(
      `llama-server: active model changed on disk — restarting with ${path.basename(gguf)} (was ${path.basename(lastSpawnedGgufPath || '')})`
    );
    await stopLlamaServerIfWeStarted();
    await new Promise((r) => setTimeout(r, 600));
  }

  try {
    const up = await probeLlamaServerReachable(url, 2500);
    if (up) {
      if (!weStarted) {
        logger.warn(
          `llama-server is already listening at ${url} but was not started by this app. ` +
            `It will keep serving whatever GGUF it was launched with. To use "${path.basename(gguf)}", stop that process and click **Start server** here, or run: llama-server.exe -m "${gguf}" ...`
        );
      }
      logger.info('llama-server already responding on port; not starting another process.');
      return { ok: true, skipped: true };
    }
  } catch {
    /* proceed to spawn */
  }

  logger.info(`Starting llama-server: ${exe}`);
  logger.info(`  model ${gguf}`);
  logger.info(`  ${host}:${port}`);

  child = spawn(exe, ['-m', gguf, '--host', host, '--port', port], {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  weStarted = true;

  child.stderr?.on('data', (buf) => {
    const s = buf.toString().trim();
    if (s) logger.warn(`llama-server: ${s.slice(0, 500)}`);
  });
  child.stdout?.on('data', (buf) => {
    const s = buf.toString().trim();
    if (s) logger.info(`llama-server: ${s.slice(0, 300)}`);
  });
  child.on('error', (e) => {
    logger.error(`llama-server spawn error: ${e.message}`);
  });
  child.on('exit', (code, sig) => {
    if (weStarted) {
      logger.warn(`llama-server process exited (code=${code}, signal=${sig || 'none'})`);
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
  });

  try {
    await waitForTcpPort(host, port);
    lastSpawnedGgufPath = gguf;
    logger.info('llama-server is listening.');
    return { ok: true, skipped: false };
  } catch (e) {
    logger.error(e.message);
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
    return { ok: false, error: e.message };
  }
}

export async function stopLlamaServerIfWeStarted() {
  if (!child || !weStarted) return;
  try {
    logger.info('Stopping llama-server process we started…');
    child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
  } catch (e) {
    logger.warn(`stop llama-server: ${e.message}`);
  }
  child = null;
  weStarted = false;
  lastSpawnedGgufPath = null;
}

export function llamaProcessRunning() {
  return Boolean(child && weStarted);
}

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
    error: `llama-server is not reachable at ${url}. Click Start server in the Control Panel, enable auto-start with the bot, or run llama-server manually.`,
  };
}
