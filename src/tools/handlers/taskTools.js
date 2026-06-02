import {
  addTask,
  completeTask,
  deleteTask,
  formatTasksForTool,
  listTasks,
  previewTaskAdd,
  previewTaskDelete,
} from "../../tasks/tasks.js";

export async function handleTaskList(userId, args) {
  const status = String(args?.status || "open").toLowerCase();
  const rows = await listTasks(userId, { status, limit: args?.limit });
  return { ok: true, data: { tasks: rows, text: formatTasksForTool(rows) } };
}

export async function handleTaskAdd(userId, args) {
  try {
    const row = await addTask(userId, {
      title: args?.title,
      due_at: args?.due_at,
      priority: args?.priority,
      notes: args?.notes,
    });
    return {
      ok: true,
      data: { task: row, text: `Added task #${row.id}: "${row.title}".` },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function handleTaskComplete(userId, args) {
  const id = Number(args?.task_id);
  if (!Number.isFinite(id)) return { ok: false, error: "task_id is required." };
  const row = await completeTask(userId, id);
  if (!row) return { ok: false, error: `No open task with id ${id}.` };
  return { ok: true, data: { task: row, text: `Completed task #${row.id}: "${row.title}".` } };
}

export async function handleTaskDelete(userId, args) {
  const id = Number(args?.task_id);
  if (!Number.isFinite(id)) return { ok: false, error: "task_id is required." };
  const ok = await deleteTask(userId, id);
  if (!ok) return { ok: false, error: `No task with id ${id}.` };
  return { ok: true, data: { text: `Deleted task #${id}.` } };
}

export { previewTaskAdd, previewTaskDelete };
