import { describe, it, expect } from 'vitest';
import { normalizeTelegramHandle, buildTelegramProfileUrl } from '../src/util/telegramLink.js';

describe('telegramLink', () => {
  it('normalizes @username and builds t.me URL', () => {
    expect(normalizeTelegramHandle('@MyAdmin')).toBe('myadmin');
    expect(buildTelegramProfileUrl('@MyAdmin')).toBe('https://t.me/myadmin');
  });

  it('accepts full t.me links', () => {
    expect(buildTelegramProfileUrl('https://t.me/sena_admin')).toBe('https://t.me/sena_admin');
  });

  it('rejects invalid handles', () => {
    expect(buildTelegramProfileUrl('ab')).toBeNull();
  });
});
