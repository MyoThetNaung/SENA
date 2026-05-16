/**
 * Next.js custom server + Express API (`npm run gui` / `web/server.mjs`).
 */
import { createServer } from 'http';
import { parse } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import next from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', '..', 'web');
const projectRoot = path.join(__dirname, '..', '..');

let started = null;

/**
 * @param {{ port?: number, host?: string, dev?: boolean }} [options]
 * @returns {Promise<{ server: import('http').Server, port: number, url: string }>}
 */
export async function startSenaWebServer(options = {}) {
  if (started) return started;

  const dev = options.dev ?? process.env.NODE_ENV !== 'production';
  const port = Math.min(
    65535,
    Math.max(1024, Number(options.port ?? process.env.PORT ?? process.env.GUI_PORT) || 3000)
  );
  const host = String(options.host ?? process.env.GUI_HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const bindHost = host.toLowerCase() === 'localhost' ? '127.0.0.1' : host;
  const logHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost;

  process.chdir(projectRoot);

  const { createApiApp } = await import('../gui/server.js');
  const { getPool } = await import('../db.js');
  const { initAuth } = await import('../auth/routes.js');
  const { logger } = await import('../logger.js');

  logger.info('Connecting to PostgreSQL…');
  await getPool();
  logger.info('Running auth init…');
  await initAuth();

  logger.info('Starting Next.js…');
  const nextApp = next({ dev, dir: webDir });
  const handle = nextApp.getRequestHandler();
  const apiApp = createApiApp();

  await nextApp.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
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

  started = { server, port, url };
  return started;
}
