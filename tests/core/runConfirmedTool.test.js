import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/llm/chatWithTools.js', () => ({
  providerSupportsTools: () => true,
  chatWithTools: vi.fn(),
}));

vi.mock('../../src/tools/executor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeTool: vi.fn(),
  };
});

import { chatWithTools } from '../../src/llm/chatWithTools.js';
import { executeTool } from '../../src/tools/executor.js';
import { runConfirmedTool } from '../../src/core/agentRunner.js';

describe('runConfirmedTool resume', () => {
  beforeEach(() => {
    vi.mocked(executeTool).mockReset();
    vi.mocked(chatWithTools).mockReset();
  });

  it('resumes agent loop after confirmed tool when agentState is present', async () => {
    vi.mocked(executeTool).mockResolvedValueOnce({
      ok: true,
      text: 'Added task #1: "Demo".',
      data: { text: 'Added task #1: "Demo".' },
    });
    vi.mocked(chatWithTools).mockResolvedValueOnce({
      message: { role: 'assistant', content: 'Done — I added your task.' },
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 5,
    });

    const payload = {
      toolName: 'task_add',
      args: { title: 'Demo' },
      agentState: {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'add task Demo' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', function: { name: 'task_add', arguments: '{}' } }],
          },
        ],
        toolCallId: 'call_1',
        userText: 'add task Demo',
      },
    };

    const out = await runConfirmedTool(1, payload, 'yes');
    expect(out.reply).toBe('Done — I added your task.');
    expect(chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('falls back to tool text when resume is unavailable', async () => {
    vi.mocked(executeTool).mockResolvedValueOnce({
      ok: true,
      text: 'Raw tool output.',
    });

    const out = await runConfirmedTool(1, { toolName: 'task_add', args: {} }, '');
    expect(out.reply).toBe('Raw tool output.');
    expect(chatWithTools).not.toHaveBeenCalled();
  });
});
