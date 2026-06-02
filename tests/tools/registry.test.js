import { describe, it, expect } from 'vitest';
import { getToolDefinition, listOpenAiTools, listToolDefinitions } from '../../src/tools/registry.js';

describe('tool registry', () => {
  it('lists calendar and web search tools', () => {
    const names = listToolDefinitions().map((t) => t.name);
    expect(names).toContain('calendar_list_events');
    expect(names).toContain('calendar_add_event');
    expect(names).toContain('web_search');
    expect(names).toContain('search_knowledge');
  });

  it('exports OpenAI-compatible schemas', () => {
    const tools = listOpenAiTools();
    expect(tools.length).toBeGreaterThanOrEqual(3);
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect(t.function.name).toBeTruthy();
      expect(t.function.parameters?.type).toBe('object');
    }
  });

  it('resolves tool by name', () => {
    const t = getToolDefinition('calendar_add_event');
    expect(t?.risk).toBe('write');
  });
});
