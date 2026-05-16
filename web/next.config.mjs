import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '..'),
  transpilePackages: [],
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@sena': path.join(__dirname, '..', 'src'),
    };
    return config;
  },
  serverExternalPackages: [
    'pg',
    'puppeteer',
    'bcryptjs',
    'node-telegram-bot-api',
    'winston',
  ],
};

export default nextConfig;
