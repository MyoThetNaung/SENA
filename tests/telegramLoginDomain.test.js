import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeTelegramWidgetDomain,
  resolveTelegramWidgetDomain,
  buildTelegramLoginWidgetHints,
} from '../src/auth/telegramLoginDomain.js';

describe('normalizeTelegramWidgetDomain', () => {
  it('strips scheme, path, and port', () => {
    expect(normalizeTelegramWidgetDomain('https://Example.com:3847/app')).toBe('example.com');
    expect(normalizeTelegramWidgetDomain('localhost:3000')).toBe('localhost');
    expect(normalizeTelegramWidgetDomain('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('resolveTelegramWidgetDomain', () => {
  const prev = process.env.TELEGRAM_LOGIN_DOMAIN;

  afterEach(() => {
    if (prev === undefined) delete process.env.TELEGRAM_LOGIN_DOMAIN;
    else process.env.TELEGRAM_LOGIN_DOMAIN = prev;
  });

  it('uses Host header when no override', () => {
    const req = { get: (h) => (h === 'host' ? '127.0.0.1:3847' : undefined), headers: {} };
    expect(resolveTelegramWidgetDomain(req)).toBe('127.0.0.1');
  });

  it('prefers TELEGRAM_LOGIN_DOMAIN env', () => {
    process.env.TELEGRAM_LOGIN_DOMAIN = 'sena.example.com';
    const req = { get: (h) => (h === 'host' ? 'localhost:3847' : undefined), headers: {} };
    expect(resolveTelegramWidgetDomain(req)).toBe('sena.example.com');
  });
});

describe('buildTelegramLoginWidgetHints', () => {
  it('includes localhost note for loopback hostnames', () => {
    const req = {
      protocol: 'http',
      get: (h) => {
        if (h === 'host') return 'localhost:3847';
        return undefined;
      },
      headers: { host: 'localhost:3847' },
    };
    const hints = buildTelegramLoginWidgetHints(req);
    expect(hints.widgetDomain).toBe('localhost');
    expect(hints.loginOrigin).toBe('http://localhost:3847');
    expect(hints.localhostNote).toMatch(/localhost and 127\.0\.0\.1/);
  });
});
