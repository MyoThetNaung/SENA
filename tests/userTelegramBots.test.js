import { describe, it, expect } from 'vitest';
import { maskBotToken, isValidTelegramBotToken } from '../src/access/userTelegramBots.js';

describe('userTelegramBots', () => {
  it('masks tokens like admin panel', () => {
    expect(maskBotToken('1234567890:ABCDEFghijklmnopqrstuvwxyz')).toMatch(/^1234\.\.\./);
  });

  it('validates telegram bot token format', () => {
    expect(isValidTelegramBotToken('123:abc_defghijklmnopqrst')).toBe(true);
    expect(isValidTelegramBotToken('bad')).toBe(false);
    expect(isValidTelegramBotToken('')).toBe(false);
  });
});
