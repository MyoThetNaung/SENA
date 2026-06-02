import { describe, it, expect } from 'vitest';
import { executeTool, formatToolResultForModel } from '../../src/tools/executor.js';
import { needsConfirmation } from '../../src/tools/risk.js';

describe('tool executor', () => {
  it('requires confirmation for write tools', async () => {
    const r = await executeTool(1, 'calendar_add_event', {
      title: 'Standup',
      starts_at: '2026-06-04T09:00:00.000Z',
    });
    expect(r.needsConfirmation).toBe(true);
    expect(r.preview).toMatch(/Add calendar event/i);
  });

  it('requires confirmation for web_search', async () => {
    const r = await executeTool(1, 'web_search', { query: 'weather in Yangon' });
    expect(r.needsConfirmation).toBe(true);
    expect(r.toolName).toBe('web_search');
  });

  it('requires confirmation for task_add', async () => {
    const r = await executeTool(1, 'task_add', { title: 'Review PR' });
    expect(r.needsConfirmation).toBe(true);
    expect(r.preview).toMatch(/Add task/i);
  });

  it('requires confirmation for task_delete', async () => {
    const r = await executeTool(1, 'task_delete', { task_id: 7 });
    expect(r.needsConfirmation).toBe(true);
    expect(r.preview).toMatch(/Delete task/i);
  });

  it('formatToolResultForModel encodes errors', () => {
    const s = formatToolResultForModel({ ok: false, error: 'nope' });
    const j = JSON.parse(s);
    expect(j.status).toBe('error');
  });

  it('needsConfirmation respects confirmed flag', () => {
    expect(needsConfirmation('write', { confirmed: true })).toBe(false);
    expect(needsConfirmation('write', {})).toBe(true);
  });
});
