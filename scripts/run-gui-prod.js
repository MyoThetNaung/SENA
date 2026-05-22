/**
 * Production GUI: pre-built Next.js, no dev WebSocket / HMR.
 * Usage: npm run gui:prod
 */
process.env.NODE_ENV = 'production';
process.env.SENA_WEB_PRODUCTION = '1';
await import('../src/gui-main.js');
