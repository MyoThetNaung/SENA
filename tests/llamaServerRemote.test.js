import { describe, it, expect } from 'vitest';
import { isLlamaServerRemote, resolveLlamaServerMode } from '../src/config.js';

describe('resolveLlamaServerMode', () => {
  it('reads explicit mode', () => {
    expect(resolveLlamaServerMode({ llamaServerMode: 'remote' })).toBe('remote');
    expect(resolveLlamaServerMode({ llamaServerMode: 'local' })).toBe('local');
  });

  it('migrates legacy llamaServerExternal flag', () => {
    expect(resolveLlamaServerMode({ llamaServerExternal: true })).toBe('remote');
    expect(resolveLlamaServerMode({ llamaServerExternal: 'true' })).toBe('remote');
    expect(resolveLlamaServerMode({ llamaServerExternal: false })).toBe('local');
  });
});

describe('isLlamaServerRemote', () => {
  it('respects explicit mode', () => {
    expect(
      isLlamaServerRemote({ llamaServerMode: 'remote', llamaServerUrl: 'http://127.0.0.1:8080' })
    ).toBe(true);
    expect(
      isLlamaServerRemote({ llamaServerMode: 'local', llamaServerUrl: 'https://api.example.com' })
    ).toBe(false);
  });

  it('infers from hostname when mode unset', () => {
    expect(isLlamaServerRemote({ llamaServerUrl: 'https://llama.example.com/v1' })).toBe(true);
    expect(isLlamaServerRemote({ llamaServerUrl: 'http://127.0.0.1:8080' })).toBe(false);
  });
});
