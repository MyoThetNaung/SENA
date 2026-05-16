import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { getConfig, resolveUserPath, isLlamaServerRemote } from '../config.js';
import { logger } from '../logger.js';
import { probeLlamaServerReachable } from './catalog.js';

let child = null;
let weStarted = false;
let ollamaChild = null;
let ollamaWeStarted = false;
/** Full path of GGUF this app loaded (llama-server only loads one model per process). */
let lastSpawnedGgufPath = null;
let lastSpawnedMmprojPath = null;
const macQuarantineClearedTargets = new Set();

const EMBEDDED_LOG_CAP = 400;
const EMBEDDED_LOG_LINE_MAX = 800;
/** @type {string[]} */
let embeddedLlamaLogLines = [];
let embeddedLastSpawnError = '';
let lastEmbeddedListenHost = '';
let lastEmbeddedListenPort = '';

function pushEmbeddedLlamaLog(line) {
  const s = String(line || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((x) => x.trimEnd())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!s) return;
  const clipped = s.length > EMBEDDED_LOG_LINE_MAX ? `${s.slice(0, EMBEDDED_LOG_LINE_MAX)}…` : s;
  const stamp = new Date().toISOString().slice(11, 23);
  embeddedLlamaLogLines.push(`[${stamp}] ${clipped}`);
  if (embeddedLlamaLogLines.length > EMBEDDED_LOG_CAP) {
    embeddedLlamaLogLines = embeddedLlamaLogLines.slice(-EMBEDDED_LOG_CAP);
  }
}

function clearEmbeddedLlamaLogs() {
  embeddedLlamaLogLines = [];
}

export function getEmbeddedLlamaRecentLogs(limit = 80) {
  const n = Math.min(EMBEDDED_LOG_CAP, Math.max(1, Number(limit) || 80));
  return embeddedLlamaLogLines.slice(-n);
}

export function getEmbeddedLlamaPanelState() {
  const running = Boolean(child && weStarted);
  return {
    running,
    host: lastEmbeddedListenHost || null,
    port: lastEmbeddedListenPort || null,
    lastError: embeddedLastSpawnError || '',
    modelPath: lastSpawnedGgufPath,
    mmprojPath: lastSpawnedMmprojPath,
    logs: getEmbeddedLlamaRecentLogs(40),
  };
}

function isValidVisionProjectorPath(p) {
  const s = String(p || '').trim();
  if (!s) return false;
  return /\.(mmproj|gguf)$/i.test(s);
}

/** Same rules as GUI server: absolute paths as-is; relative paths under app data / project root (never cwd). */
function resolveModelPathForSpawn(p) {
  const t = String(p || '').trim();
  if (!t) return '';
  if (path.isAbsolute(t)) return path.normalize(t);
  return resolveUserPath(t, 'models');
}

function wireLlamaChildStreams(proc) {
  proc.stderr?.on('data', (buf) => {
    const raw = buf.toString();
    const s = raw.trim();
    if (!s) return;
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      pushEmbeddedLlamaLog(`stderr: ${t.slice(0, 600)}`);
      logger.warn(`llama-server: ${t.slice(0, 500)}`);
    }
  });
  proc.stdout?.on('data', (buf) => {
    const raw = buf.toString();
    const s = raw.trim();
    if (!s) return;
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      pushEmbeddedLlamaLog(`stdout: ${t.slice(0, 400)}`);
      logger.info(`llama-server: ${t.slice(0, 300)}`);
    }
  });
  proc.on('error', (e) => {
    const msg = e?.message || String(e);
    embeddedLastSpawnError = msg;
    logger.error(`llama-server spawn error: ${msg}`);
    pushEmbeddedLlamaLog(`spawn error: ${msg}`);
  });
}

function normalizeModelsPath(modelsDir) {
  const raw = String(modelsDir || '').trim();
  if (!raw) return { dir: raw, pinnedGguf: null };
  if (/\.gguf$/i.test(raw)) {
    return { dir: path.dirname(raw), pinnedGguf: raw };
  }
  try {
    if (!fs.existsSync(raw)) return { dir: raw, pinnedGguf: null };
    const st = fs.statSync(raw);
    if (st.isDirectory()) return { dir: raw, pinnedGguf: null };
    if (st.isFile() && /\.gguf$/i.test(raw)) {
      return { dir: path.dirname(raw), pinnedGguf: raw };
    }
    if (st.isFile()) return { dir: path.dirname(raw), pinnedGguf: null };
  } catch {
    /* ignore path stat errors and fall back */
  }
  return { dir: raw, pinnedGguf: null };
}

function resolveBinary(engineDir) {
  const win = process.platform === 'win32';
  const names = win ? ['llama-server.exe', 'llama-server'] : ['llama-server', 'llama-server.exe'];
  const folders = ['', 'llama-b9093'];
  for (const folder of folders) {
    for (const n of names) {
      const p = folder ? path.join(engineDir, folder, n) : path.join(engineDir, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function resolveOllamaBinary(engineDir) {
  const names = process.platform === 'win32' ? ['ollama.exe', 'ollama'] : ['ollama', 'ollama.exe'];
  for (const n of names) {
    const p = path.join(engineDir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function prepareMacExecutable(exePath) {
  if (process.platform !== 'darwin') return;
  const target = path.dirname(exePath);
  if (!macQuarantineClearedTargets.has(target)) {
    const out = spawnSync('xattr', ['-dr', 'com.apple.quarantine', target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out.error) {
      logger.warn(`Could not clear macOS quarantine for ${target}: ${out.error.message}`);
    } else if (out.status !== 0 && out.stderr) {
      logger.warn(`macOS quarantine cleanup for ${target}: ${out.stderr.trim()}`);
    } else {
      logger.info(`Cleared macOS quarantine attributes for ${target}`);
    }
    macQuarantineClearedTargets.add(target);
  }
  try {
    fs.chmodSync(exePath, 0o755);
  } catch (e) {
    logger.warn(`Could not mark executable: ${e.message}`);
  }
}

/** Find .gguf for Active model name (or single file in folder). */
export function resolveGgufPath(modelsDir, modelName) {
  const { dir, pinnedGguf } = normalizeModelsPath(modelsDir);
  if (pinnedGguf && fs.existsSync(pinnedGguf)) return pinnedGguf;
  if (!fs.existsSync(dir)) return null;
  const clean = String(modelName || '').replace(/\.gguf$/i, '').trim();
  const direct = path.join(dir, `${clean}.gguf`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
  const want = clean.toLowerCase();
  const hit = files.find((f) => f.replace(/\.gguf$/i, '').toLowerCase() === want);
  if (hit) return path.join(dir, hit);
  if (files.length === 1) {
    logger.info(`Using only GGUF in folder: ${files[0]}`);
    return path.join(dir, files[0]);
  }
  return null;
}

/** Find vision projection file for multimodal models (mmproj*.gguf). */
export function resolveMmprojPath(modelsDir, modelPath) {
  const { dir } = normalizeModelsPath(modelsDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
  if (!files.length) return null;
  const modelBase = path.basename(String(modelPath || '')).toLowerCase();
  const mmprojFiles = files.filter((f) => /mmproj/i.test(f));
  if (!mmprojFiles.length) return null;
  const near = mmprojFiles.find((f) => {
    const s = f.toLowerCase();
    if (modelBase.includes('gemma-4') && s.includes('gemma-4')) return true;
    if (modelBase.includes('qwen3') && s.includes('qwen3')) return true;
    if (modelBase.includes('qwen') && s.includes('qwen')) return true;
    if (modelBase.includes('llava') && s.includes('llava')) return true;
    return false;
  });
  return path.join(dir, near || mmprojFiles[0]);
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

function hostPortEnvFromUrl(urlStr, fallback = '127.0.0.1:11434') {
  try {
    const u = new URL(urlStr);
    const host = u.hostname || '127.0.0.1';
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${host}:${port}`;
  } catch {
    return fallback;
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
 * Start llama-server with explicit GGUF / optional projector paths (UI or API).
 * Stops any llama-server process previously started by this app, then spawns with `-m`, `--mmproj` (if set),
 * `--port`, `--ctx-size`, and `--jinja`.
 * @param {{ ggufPath: string, mmprojPath?: string|null, host?: string, port: string|number, ctxSize?: number }} opts
 */
export async function startEmbeddedLlamaServerFromPaths(opts = {}) {
  const gguf = resolveModelPathForSpawn(String(opts.ggufPath || ''));
  const mmprojOptRaw = String(opts.mmprojPath ?? '').trim();
  const mmprojOpt = mmprojOptRaw ? resolveModelPathForSpawn(mmprojOptRaw) : null;
  const ctxSize = Math.min(131072, Math.max(256, Number(opts.ctxSize) || 4096));
  embeddedLastSpawnError = '';
  clearEmbeddedLlamaLogs();

  if (!gguf) {
    embeddedLastSpawnError = 'Main model path is required.';
    return { ok: false, error: embeddedLastSpawnError };
  }
  if (!fs.existsSync(gguf)) {
    embeddedLastSpawnError = `Main model file does not exist at: ${gguf}`;
    return { ok: false, error: embeddedLastSpawnError };
  }
  if (!/\.gguf$/i.test(gguf)) {
    embeddedLastSpawnError = 'Main model must be a .gguf file.';
    return { ok: false, error: embeddedLastSpawnError };
  }
  if (mmprojOpt) {
    if (!fs.existsSync(mmprojOpt)) {
      embeddedLastSpawnError = `Multimodal projector file does not exist at: ${mmprojOpt}`;
      return { ok: false, error: embeddedLastSpawnError };
    }
    if (!isValidVisionProjectorPath(mmprojOpt)) {
      embeddedLastSpawnError = 'Projector must be a .mmproj or .gguf file.';
      return { ok: false, error: embeddedLastSpawnError };
    }
  }

  const c = getConfig();
  const exe = resolveBinary(c.engineDir);
  if (!exe) {
    embeddedLastSpawnError = `No llama-server binary in ${c.engineDir}`;
    return { ok: false, error: embeddedLastSpawnError };
  }
  prepareMacExecutable(exe);
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    try {
      fs.chmodSync(exe, 0o755);
    } catch (e) {
      logger.warn(`Could not mark llama-server executable: ${e.message}`);
    }
  }

  const host = String(opts.host || '127.0.0.1').trim() || '127.0.0.1';
  const portNum = Number(opts.port);
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
    embeddedLastSpawnError = 'Invalid or missing port.';
    return { ok: false, error: embeddedLastSpawnError };
  }

  pushEmbeddedLlamaLog(`Preparing embedded llama-server on ${host}:${portNum} (ctx-size ${ctxSize})`);

  await stopLlamaServerIfWeStarted();
  await new Promise((r) => setTimeout(r, 500));

  const probeUrl = `http://${host}:${portNum}`.replace(/\/$/, '');
  try {
    const up = await probeLlamaServerReachable(probeUrl, 800);
    if (up) {
      embeddedLastSpawnError = `Port ${portNum} is already in use. Stop the other process or change the llama-server base URL in settings.`;
      return { ok: false, error: embeddedLastSpawnError };
    }
  } catch {
    /* unreachable — treat as free */
  }

  const args = ['-m', gguf, '--host', host, '--port', String(portNum), '--ctx-size', String(ctxSize), '--jinja'];
  if (mmprojOpt) args.push('--mmproj', mmprojOpt);

  logger.info(`Starting llama-server (explicit paths): ${exe}`);
  logger.info(`  model ${gguf}`);
  if (mmprojOpt) logger.info(`  mmproj ${mmprojOpt}`);

  child = spawn(exe, args, {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  weStarted = true;
  wireLlamaChildStreams(child);
  child.on('exit', (code, sig) => {
    if (weStarted) {
      pushEmbeddedLlamaLog(`Process exited (code=${code}, signal=${sig || 'none'})`);
      const intentionalStop = sig === 'SIGTERM' || sig === 'SIGKILL';
      if (!intentionalStop && code !== 0 && code !== null) {
        embeddedLastSpawnError = `llama-server stopped unexpectedly (exit ${code})`;
      }
      logger.warn(`llama-server process exited (code=${code}, signal=${sig || 'none'})`);
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
    lastSpawnedMmprojPath = null;
    lastEmbeddedListenHost = '';
    lastEmbeddedListenPort = '';
  });

  try {
    await waitForTcpPort(host, portNum, 90000);
    lastSpawnedGgufPath = gguf;
    lastSpawnedMmprojPath = mmprojOpt;
    lastEmbeddedListenHost = host;
    lastEmbeddedListenPort = String(portNum);
    embeddedLastSpawnError = '';
    logger.info('llama-server is listening.');
    return {
      ok: true,
      host,
      port: portNum,
      url: `http://${host}:${portNum}`,
      ctxSize,
    };
  } catch (e) {
    logger.error(e.message);
    embeddedLastSpawnError = e.message;
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
    lastSpawnedMmprojPath = null;
    lastEmbeddedListenHost = '';
    lastEmbeddedListenPort = '';
    return { ok: false, error: e.message };
  }
}

/**
 * If backend is llama-server and (force GUI start | auto-start flag | env), spawn engine/llama-server.exe.
 * @param {boolean} [force] When true, start whenever provider is llama-server (e.g. Control Panel Start bot).
 * When false, start only if autoStartLlamaServer / AUTO_START_LLAMA_SERVER (e.g. headless `src/index.js`).
 */
export async function startLlamaServerIfConfigured(force = false) {
  const c = getConfig();
  if (c.llmProvider !== 'llama-server') {
    return { ok: true, skipped: true };
  }
  if (isLlamaServerRemote(c)) {
    return { ok: true, skipped: true, remote: true };
  }
  const wantStart =
    force ||
    c.autoStartLlamaServer === true ||
    process.env.AUTO_START_LLAMA_SERVER === '1';
  if (!wantStart) {
    return { ok: true, skipped: true };
  }

  const { dir: modelsDirResolved } = normalizeModelsPath(c.modelsDir);
  try {
    fs.mkdirSync(modelsDirResolved, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Could not create models folder: ${modelsDirResolved} (${e.message})` };
  }

  const exe = resolveBinary(c.engineDir);
  if (!exe) {
    logger.error(
      `autoStartLlamaServer: no llama-server binary in ${c.engineDir}. Expected llama-b9093/llama-server or llama-server.`
    );
    return { ok: false, error: `No embedded llama-server binary found in ${c.engineDir}` };
  }
  prepareMacExecutable(exe);
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    try {
      fs.chmodSync(exe, 0o755);
    } catch (e) {
      logger.warn(`Could not mark llama-server executable: ${e.message}`);
    }
  }

  const configuredMmproj = String(c.mmprojPath || '').trim();
  const mmprojDirCandidate =
    configuredMmproj && fs.existsSync(configuredMmproj) ? path.dirname(configuredMmproj) : '';

  let gguf = null;
  const configuredGguf = String(c.ggufPath || '').trim();
  if (configuredGguf && fs.existsSync(configuredGguf) && /\.gguf$/i.test(configuredGguf)) {
    gguf = configuredGguf;
  }
  if (!gguf) gguf = resolveGgufPath(c.modelsDir, c.llmModel);
  if (!gguf && mmprojDirCandidate) {
    gguf = resolveGgufPath(mmprojDirCandidate, c.llmModel);
    if (gguf) {
      logger.info(
        `Resolved GGUF via mmproj folder fallback: ${path.basename(gguf)} (from ${mmprojDirCandidate})`
      );
    }
  }
  if (!gguf) {
    logger.error(
      `autoStartLlamaServer: no matching .gguf in ${modelsDirResolved} for model "${c.llmModel}".` +
        (mmprojDirCandidate ? ` Also checked mmproj folder: ${mmprojDirCandidate}.` : '') +
        ' Add a file or rename Active model.'
    );
    return { ok: false, error: 'No GGUF file found for the selected model' };
  }
  let mmproj = null;
  if (configuredMmproj && fs.existsSync(configuredMmproj) && /\.(gguf|mmproj)$/i.test(configuredMmproj)) {
    mmproj = configuredMmproj;
  } else {
    mmproj = resolveMmprojPath(mmprojDirCandidate || c.modelsDir, gguf);
  }

  const { host, port } = parseServerUrl(c.llamaServerUrl);
  const url = c.llamaServerUrl.replace(/\/$/, '');

  if (child && weStarted) {
    if (lastSpawnedGgufPath === gguf && lastSpawnedMmprojPath === mmproj) {
      logger.info(`llama-server already running with selected model (${path.basename(gguf)})`);
      lastEmbeddedListenHost = host;
      lastEmbeddedListenPort = port;
      return { ok: true, skipped: false };
    }
    logger.info(
      `llama-server: active model changed on disk — restarting with ${path.basename(gguf)} (was ${path.basename(lastSpawnedGgufPath || '')})`
    );
    await stopLlamaServerIfWeStarted();
    await new Promise((r) => setTimeout(r, 1000));
  }

  try {
    const up = await probeLlamaServerReachable(url, 2500);
    if (up) {
      if (!weStarted) {
        logger.warn(
          `llama-server is already listening at ${url} but was not started by this app. ` +
            `It will keep serving whatever GGUF it was launched with. To use "${path.basename(gguf)}", stop that process and start the bot again from the Control Panel, or run: llama-server.exe -m "${gguf}" ...`
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
  if (mmproj) logger.info(`  mmproj ${mmproj}`);
  else logger.warn('  mmproj not found in models folder; image input will not work for multimodal prompts.');
  logger.info(`  ${host}:${port}`);
  const args = ['-m', gguf, '--host', host, '--port', port, '--ctx-size', '4096', '--jinja'];
  if (mmproj) args.push('--mmproj', mmproj);
  child = spawn(exe, args, {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  weStarted = true;
  wireLlamaChildStreams(child);
  child.on('exit', (code, sig) => {
    if (weStarted) {
      pushEmbeddedLlamaLog(`Process exited (code=${code}, signal=${sig || 'none'})`);
      const intentionalStop = sig === 'SIGTERM' || sig === 'SIGKILL';
      if (!intentionalStop && code !== 0 && code !== null) {
        embeddedLastSpawnError = `llama-server stopped unexpectedly (exit ${code})`;
      }
      logger.warn(`llama-server process exited (code=${code}, signal=${sig || 'none'})`);
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
    lastSpawnedMmprojPath = null;
    lastEmbeddedListenHost = '';
    lastEmbeddedListenPort = '';
  });

  try {
    await waitForTcpPort(host, port);
    lastSpawnedGgufPath = gguf;
    lastSpawnedMmprojPath = mmproj;
    lastEmbeddedListenHost = host;
    lastEmbeddedListenPort = port;
    embeddedLastSpawnError = '';
    logger.info('llama-server is listening.');
    return { ok: true, skipped: false };
  } catch (e) {
    logger.error(e.message);
    embeddedLastSpawnError = e.message;
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    child = null;
    weStarted = false;
    lastSpawnedGgufPath = null;
    lastSpawnedMmprojPath = null;
    lastEmbeddedListenHost = '';
    lastEmbeddedListenPort = '';
    return { ok: false, error: e.message };
  }
}

export async function startOllamaServerIfConfigured(force = false) {
  const c = getConfig();
  if (c.llmProvider !== 'ollama') {
    return { ok: true, skipped: true };
  }
  const wantStart = force || process.env.AUTO_START_OLLAMA === '1';
  if (!wantStart) {
    return { ok: true, skipped: true };
  }

  const url = c.ollamaBaseUrl.replace(/\/$/, '');
  try {
    const up = await probeLlamaServerReachable(url, 2500);
    if (up) {
      logger.info('Ollama already responding; not starting another process.');
      return { ok: true, skipped: true };
    }
  } catch {
    /* proceed to spawn */
  }

  const exe = resolveOllamaBinary(c.engineDir);
  if (!exe) {
    return { ok: false, error: `No embedded Ollama binary found in ${c.engineDir}` };
  }
  prepareMacExecutable(exe);
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    try {
      fs.chmodSync(exe, 0o755);
    } catch (e) {
      logger.warn(`Could not mark Ollama executable: ${e.message}`);
    }
  }

  const { host, port } = parseServerUrl(c.ollamaBaseUrl);
  logger.info(`Starting embedded Ollama: ${exe}`);
  logger.info(`  ${host}:${port}`);
  ollamaChild = spawn(exe, ['serve'], {
    cwd: path.dirname(exe),
    env: { ...process.env, OLLAMA_HOST: hostPortEnvFromUrl(c.ollamaBaseUrl) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  ollamaWeStarted = true;

  ollamaChild.stderr?.on('data', (buf) => {
    const s = buf.toString().trim();
    if (s) logger.warn(`ollama: ${s.slice(0, 500)}`);
  });
  ollamaChild.stdout?.on('data', (buf) => {
    const s = buf.toString().trim();
    if (s) logger.info(`ollama: ${s.slice(0, 300)}`);
  });
  ollamaChild.on('exit', (code, sig) => {
    if (ollamaWeStarted) {
      logger.warn(`Ollama process exited (code=${code}, signal=${sig || 'none'})`);
    }
    ollamaChild = null;
    ollamaWeStarted = false;
  });

  try {
    await waitForTcpPort(host, port);
    logger.info('Ollama is listening.');
    return { ok: true, skipped: false };
  } catch (e) {
    try {
      ollamaChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    ollamaChild = null;
    ollamaWeStarted = false;
    return { ok: false, error: e.message };
  }
}

export async function stopLlamaServerIfWeStarted() {
  if (child && weStarted) {
    try {
      embeddedLastSpawnError = '';
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
    lastSpawnedMmprojPath = null;
  }

  if (!ollamaChild || !ollamaWeStarted) return;
  try {
    logger.info('Stopping embedded Ollama process…');
    ollamaChild.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    if (ollamaChild && !ollamaChild.killed) {
      ollamaChild.kill('SIGKILL');
    }
  } catch (e) {
    logger.warn(`stop Ollama: ${e.message}`);
  }
  ollamaChild = null;
  ollamaWeStarted = false;
}

export function llamaProcessRunning() {
  return Boolean(child && weStarted);
}

export function embeddedLlmProcessRunning() {
  return Boolean((child && weStarted) || (ollamaChild && ollamaWeStarted));
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
  const remote = isLlamaServerRemote(c);
  return {
    ok: false,
    error: remote
      ? `Remote llama.cpp server is not reachable at ${url}. Check the URL, API key, and that the host is online.`
      : `llama-server is not reachable at ${url}. Click Start server in the Control Panel, enable auto-start with the bot, or run llama-server manually.`,
  };
}
