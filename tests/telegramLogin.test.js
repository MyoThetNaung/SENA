import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyTelegramLoginPayload } from '../src/auth/telegramLogin.js';

function signPayload(data, botToken) {
  const pairs = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    if (v === undefined || v === null || v === '') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...data, hash };
}

describe('verifyTelegramLoginPayload', () => {
  const token = '123456789:ABCDEFghijklmnopqrstuvwxyz1234567890';

  it('accepts a valid signed payload', () => {
    const auth_date = Math.floor(Date.now() / 1000);
    const payload = signPayload(
      {
        id: 42,
        first_name: 'Test',
        username: 'testuser',
        auth_date,
      },
      token
    );
    const r = verifyTelegramLoginPayload(payload, token);
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe(42);
    expect(r.loginHash).toBe(payload.hash);
  });

  it('rejects tampered hash', () => {
    const auth_date = Math.floor(Date.now() / 1000);
    const payload = signPayload({ id: 1, auth_date }, token);
    payload.hash = '0'.repeat(64);
    const r = verifyTelegramLoginPayload(payload, token);
    expect(r.ok).toBe(false);
  });

  it('rejects expired auth_date', () => {
    const auth_date = Math.floor(Date.now() / 1000) - 7200;
    const payload = signPayload({ id: 1, auth_date }, token);
    const r = verifyTelegramLoginPayload(payload, token);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired/i);
  });
});
