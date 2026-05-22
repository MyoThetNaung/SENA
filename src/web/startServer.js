/**
 * Next.js custom server + Express API (`npm run gui` / `web/server.mjs`).
 */
import { createServer } from 'http';
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', '..', 'web');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));

let started = null;

/**
 * Build a `url.parse`-compatible object for Next's request handler (WHATWG URL, no `url.parse`).
 * @param {string | undefined} reqUrl
 * @param {string} hostHeader
 * @param {number} port
 */
function parseRequestUrl(reqUrl, hostHeader, port) {
  const host = (hostHeader && String(hostHeader).trim()) || `127.0.0.1:${port}`;
  const absolute = new URL(reqUrl || '/', `http://${host}`);
  /** @type {Record<string, string | string[]>} */
  const query = {};
  for (const key of absolute.searchParams.keys()) {
    const values = absolute.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return { pathname: absolute.pathname || '/', query };
}

/**
 * Dev mode uses WebSocket HMR (webpack-hmr), which often fails on mobile browsers and
 * remote DDNS/port-forward — pages can hang on "Loading…". Production uses plain HTTP only.
 */
export function resolveWebDevMode(options = {}) {
  if (options.dev !== undefined) return Boolean(options.dev);
  if (process.env.NODE_ENV === 'production') return false;

  const flag = String(process.env.SENA_WEB_PRODUCTION ?? '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return false;
  if (flag === '0' || flag === 'false' || flag === 'no') return true;

  if (String(process.env.SENA_PUBLIC_ACCESS_URL || '').trim()) return false;

  return true;
}

async function ensureNextProductionBuild(webDir, logger) {
  const buildId = path.join(webDir, '.next', 'BUILD_ID');
  try {
    await fs.access(buildId);
    return;
  } catch {
    logger.info('Next.js production build not found; building now (one-time, may take a minute)…');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(npm, ['run', 'build'], {
      cwd: webDir,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    if (r.status !== 0) {
      throw new Error('Next.js production build failed. Run: npm run build --prefix web');
    }
  }
}

/**
 * @param {{ port?: number, host?: string, dev?: boolean }} [options]
 * @returns {Promise<{ server: import('http').Server, port: number, url: string, dev: boolean }>}
 */
export async function startSenaWebServer(options = {}) {
  if (started) return started;

  const dev = resolveWebDevMode(options);
  const port = Math.min(
    65535,
    Math.max(1024, Number(options.port ?? process.env.PORT ?? process.env.GUI_PORT) || 3000)
  );
  const host = String(options.host ?? process.env.GUI_HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const bindHost = host.toLowerCase() === 'localhost' ? '127.0.0.1' : host;
  const logHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost;

  const { createApiApp } = await import('../gui/server.js');
  const { getPool } = await import('../db.js');
  const { initAuth } = await import('../auth/routes.js');
  const { logger } = await import('../logger.js');

  logger.info('Connecting to PostgreSQL…');
  await getPool();
  logger.info('Running auth init…');
  await initAuth();

  if (dev) {
    logger.info('Starting Next.js (development — localhost hot reload; uses WebSocket HMR)…');
  } else {
    logger.info('Starting Next.js (production — HTTP only, stable for mobile and remote access)…');
    await ensureNextProductionBuild(webDir, logger);
  }
  // Keep Next runtime path resolution anchored to the web app directory.
  process.chdir(webDir);
  // Optional full clean (SENA_WEB_CLEAR_NEXT=1). Avoid wiping `.next` on every dev boot:
  // it can leave an open browser on a stale webpack runtime and trigger
  // "Cannot read properties of undefined (reading 'call')" in the client chunk loader.
  if (dev && String(process.env.SENA_WEB_CLEAR_NEXT || '').trim() === '1') {
    await fs.rm(path.join(webDir, '.next'), { recursive: true, force: true });
  }
  const next = requireFromWeb('next');
  const nextApp = next({ dev, dir: webDir });
  const handle = nextApp.getRequestHandler();
  const apiApp = createApiApp();

  await nextApp.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parseRequestUrl(req.url, req.headers.host, port);
    const pathname = parsedUrl.pathname || '/';
    if (pathname.startsWith('/api')) {
      apiApp(req, res);
      return;
    }
    handle(req, res, parsedUrl);
  });

  await new Promise((resolve, reject) => {
    server.listen(port, bindHost, () => resolve());
    server.on('error', reject);
  });

  const url = `http://${logHost}:${port}`;
  logger.info(`SENA web: ${url}`);
  logger.info(`Admin panel: ${url}/admin.html`);
  logger.info(`User portal: ${url}/user.html`);

  started = { server, port, url, dev };
  return started;
}
