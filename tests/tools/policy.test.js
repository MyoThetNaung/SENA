import { describe, it, expect } from 'vitest';
import { canInvokeTool } from '../../src/tools/policy.js';

describe('tool policy', () => {
  it('denies unknown tools', async () => {
    const r = await canInvokeTool(1, 'not_a_tool', {});
    expect(r.allowed).toBe(false);
  });

  it('allows calendar read tools', async () => {
    const r = await canInvokeTool(1, 'calendar_list_events', { view: 'today' });
    expect(r.allowed).toBe(true);
    expect(r.risk).toBe('read');
  });

  it('allows calendar write tool definition', async () => {
    const r = await canInvokeTool(42, 'calendar_add_event', {
      title: 'Meet',
      starts_at: '2026-06-04T10:00:00Z',
    });
    expect(r.allowed).toBe(true);
    expect(r.risk).toBe('write');
  });
});
