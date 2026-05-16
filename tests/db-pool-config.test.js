import { describe, it, expect } from 'vitest';
import { createPoolConfig } from '../src/db.js';

describe('createPoolConfig', () => {
  it('sets password to empty string when user has no password in URL', () => {
    const cfg = createPoolConfig('postgresql://admin@127.0.0.1:5432/sena');
    expect(cfg.user).toBe('admin');
    expect(cfg.password).toBe('');
    expect(typeof cfg.password).toBe('string');
  });

  it('decodes user and password from URL', () => {
    const cfg = createPoolConfig('postgresql://postgres:secret@127.0.0.1:5432/sena');
    expect(cfg.user).toBe('postgres');
    expect(cfg.password).toBe('secret');
  });
});
