import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/llm/chatWithTools.js', () => ({
  providerSupportsTools: () => true,
  chatWithTools: vi.fn(),
}));

vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      agentToolsEnabled: true,
      webSearchEnabled: true,
      llmProvider: 'llama-server',
    }),
  };
});

vi.mock('../../src/core/pending.js', () => ({
  setPending: vi.fn(),
}));

import { chatWithTools } from '../../src/llm/chatWithTools.js';
import { setPending } from '../../src/core/pending.js';
import { runAgent, AGENT_MAX_STEPS } from '../../src/core/agentRunner.js';

describe('agentRunner', () => {
  beforeEach(() => {
    vi.mocked(chatWithTools).mockReset();
    vi.mocked(setPending).mockReset();
  });

  it('exports max step limit', () => {
    expect(AGENT_MAX_STEPS).toBe(8);
  });

  it('returns final text when model does not call tools', async () => {
    vi.mocked(chatWithTools).mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Hello from agent.' },
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 10,
    });

    const out = await runAgent({
      userId: 1,
      userText: 'hi',
      buildMessages: async () => [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(out.ok).toBe(true);
    expect(out.reply).toBe('Hello from agent.');
    expect(chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('stages confirmation when a write tool is requested', async () => {
    vi.mocked(chatWithTools).mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'calendar_add_event',
              arguments: JSON.stringify({
                title: 'Demo',
                starts_at: '2026-06-04T10:00:00.000Z',
              }),
            },
          },
        ],
      },
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 10,
    });

    const out = await runAgent({
      userId: 1,
      userText: 'add meeting tomorrow',
      buildMessages: async () => [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'add meeting tomorrow' },
      ],
    });

    expect(out.wantConfirmKeyboard).toBe(true);
    expect(setPending).toHaveBeenCalledWith(
      1,
      'tool_call',
      expect.objectContaining({
        toolName: 'calendar_add_event',
        agentState: expect.objectContaining({
          toolCallId: 'call_1',
          messages: expect.any(Array),
        }),
      })
    );
  });
});
