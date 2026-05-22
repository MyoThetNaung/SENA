import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hosts allowed to hit `/_next/*` dev resources (Next 16 blocks cross-origin by default).
// Without your public DDNS host here, /login stays on "Loading sign-in…" when opened remotely.
function hostFromPublicAccessUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    const host = u.host || u.hostname;
    return host ? [host, u.hostname].filter(Boolean) : [];
  } catch {
    return s.includes(':') || !s.includes('/') ? [s] : [];
  }
}

function buildAllowedDevOrigins() {
  const fromEnv = String(process.env.SENA_DEV_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromPublic = hostFromPublicAccessUrl(process.env.SENA_PUBLIC_ACCESS_URL);
  const guiPort = Number(process.env.GUI_PORT);
  const portSuffix = Number.isFinite(guiPort) && guiPort > 0 ? `:${guiPort}` : '';
  const fromGuiHost = String(process.env.GUI_HOST || '').trim();
  const guiHostEntries = fromGuiHost
    ? [fromGuiHost, ...(portSuffix && !fromGuiHost.includes(':') ? [`${fromGuiHost}${portSuffix}`] : [])]
    : [];
  return Array.from(
    new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      ...(portSuffix ? [`localhost${portSuffix}`, `127.0.0.1${portSuffix}`] : []),
      ...guiHostEntries,
      ...fromPublic,
      ...fromEnv,
    ])
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: buildAllowedDevOrigins(),
  async redirects() {
    return [
      { source: '/user.html', destination: '/app', permanent: false },
    ];
  },
  // Monorepo: include parent dir in file tracing so the custom server can run.
  outputFileTracingRoot: path.join(__dirname, '..'),
  experimental: {
    externalDir: true,
  },
  // Native / heavy server deps used by the Express side; never bundle them into RSC builds.
  serverExternalPackages: [
    'pg',
    'puppeteer',
    'bcryptjs',
    'node-telegram-bot-api',
    'winston',
  ],
};

export default nextConfig;
