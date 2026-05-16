import { describe, it, expect } from 'vitest';
import {
  normalizeGoogleEmail,
  soulUserIdFromGoogleSub,
  buildGoogleAuthUrl,
} from '../src/auth/googleOAuth.js';

describe('normalizeGoogleEmail', () => {
  it('lowercases and trims valid emails', () => {
    expect(normalizeGoogleEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects invalid values', () => {
    expect(normalizeGoogleEmail('not-an-email')).toBeNull();
    expect(normalizeGoogleEmail('')).toBeNull();
  });
});

describe('soulUserIdFromGoogleSub', () => {
  it('returns a stable positive number', () => {
    const a = soulUserIdFromGoogleSub('google-sub-123');
    const b = soulUserIdFromGoogleSub('google-sub-123');
    const c = soulUserIdFromGoogleSub('other-sub');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBeGreaterThan(0);
  });
});

describe('buildGoogleAuthUrl', () => {
  it('includes client id and state', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const req = {
      protocol: 'http',
      get: (h) => (h === 'host' ? 'localhost:3847' : undefined),
    };
    const url = buildGoogleAuthUrl(req, 'state-abc');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('state=state-abc');
    expect(url).toContain('redirect_uri=');
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
