import { describe, it, expect } from 'vitest';
import { removeBotScopedMapKeys } from '../src/access/telegramBots.js';

describe('removeBotScopedMapKeys', () => {
  it('removes telegram id and legacy slot keys', () => {
    const out = removeBotScopedMapKeys(
      { '1': 'first', '2': 'second', '999888777': 'by-telegram-id' },
      0,
      999888777
    );
    expect(out).toEqual({ '2': 'second' });
  });
});
