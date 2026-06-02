import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../src/db.js', () => ({
  query: (...args) => mockQuery(...args),
}));

vi.mock('../../src/memory/soul.js', () => ({
  ensureSoul: vi.fn(),
}));

import {
  addTask,
  listTasks,
  completeTask,
  deleteTask,
  formatTasksForTool,
} from '../../src/tasks/tasks.js';

describe('tasks', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('addTask inserts and returns mapped row', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          user_id: 5,
          title: 'Buy milk',
          due_at: '2026-06-04T10:00:00.000Z',
          priority: 'normal',
          status: 'open',
          notes: '',
          created_at: '2026-06-03T10:00:00.000Z',
          completed_at: null,
        },
      ],
    });

    const row = await addTask(5, { title: 'Buy milk', due_at: '2026-06-04T10:00:00.000Z' });
    expect(row.title).toBe('Buy milk');
    expect(row.id).toBe(1);
  });

  it('listTasks maps rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          user_id: 5,
          title: 'Call dentist',
          due_at: null,
          priority: 'high',
          status: 'open',
          notes: '',
          created_at: '2026-06-03T10:00:00.000Z',
          completed_at: null,
        },
      ],
    });

    const rows = await listTasks(5, { status: 'open' });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Call dentist');
  });

  it('completeTask returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const row = await completeTask(5, 99);
    expect(row).toBeNull();
  });

  it('deleteTask reports success', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await deleteTask(5, 3)).toBe(true);
  });

  it('formatTasksForTool handles empty list', () => {
    expect(formatTasksForTool([])).toBe('No tasks found.');
  });
});
