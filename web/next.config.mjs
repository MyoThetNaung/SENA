import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hosts allowed to hit `/_next/*` dev resources (Next 16 blocks all by default).
// Includes localhost loopbacks, the current machine LAN IP, and any extras from env.
function buildAllowedDevOrigins() {
  const fromEnv = String(process.env.SENA_DEV_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromGuiHost = String(process.env.GUI_HOST || '').trim();
  return Array.from(
    new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      ...(fromGuiHost ? [fromGuiHost] : []),
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
