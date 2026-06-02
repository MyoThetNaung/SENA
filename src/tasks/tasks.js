import { query } from "../db.js";
import { ensureSoul } from "../memory/soul.js";

function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function addTask(userId, { title, due_at, priority, notes } = {}) {
  await ensureSoul(userId);
  const titleClean = String(title || "").trim().slice(0, 500);
  if (!titleClean) throw new Error("Task title is required");
  let dueAt = null;
  if (due_at != null && String(due_at).trim()) {
    const d = new Date(String(due_at).trim());
    if (Number.isNaN(d.getTime())) throw new Error("Invalid due_at datetime.");
    dueAt = d.toISOString();
  }
  const pri = String(priority || "normal").toLowerCase();
  const p = ["low", "normal", "high"].includes(pri) ? pri : "normal";
  const r = await query(
    `INSERT INTO user_tasks (user_id, title, due_at, priority, notes)
     VALUES ($1, $2, $3::timestamptz, $4, $5)
     RETURNING id, user_id, title, due_at, priority, status, notes, created_at, completed_at`,
    [userId, titleClean, dueAt, p, String(notes || "").slice(0, 2000)],
  );
  return mapRow(r.rows[0]);
}

export async function listTasks(userId, { status, limit } = {}) {
  const uid = Number(userId);
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  let st = String(status || "open").toLowerCase();
  if (!["open", "done", "all"].includes(st)) st = "open";
  const params = [uid];
  let where = "user_id = $1";
  if (st === "open") where += " AND status = 'open'";
  else if (st === "done") where += " AND status = 'done'";
  params.push(lim);
  const r = await query(
    `SELECT id, user_id, title, due_at, priority, status, notes, created_at, completed_at
     FROM user_tasks WHERE ${where}
     ORDER BY COALESCE(due_at, created_at) ASC
     LIMIT $2`,
    params,
  );
  return r.rows.map(mapRow);
}

export async function completeTask(userId, taskId) {
  const r = await query(
    `UPDATE user_tasks SET status = 'done', completed_at = timezone('utc', now())
     WHERE id = $1 AND user_id = $2 AND status = 'open'
     RETURNING id, user_id, title, due_at, priority, status, notes, created_at, completed_at`,
    [Number(taskId), Number(userId)],
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

export async function deleteTask(userId, taskId) {
  const r = await query(`DELETE FROM user_tasks WHERE id = $1 AND user_id = $2`, [
    Number(taskId),
    Number(userId),
  ]);
  return Number(r.rowCount || 0) > 0;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    title: row.title,
    due_at: toIso(row.due_at),
    priority: row.priority,
    status: row.status,
    notes: row.notes,
    created_at: toIso(row.created_at),
    completed_at: toIso(row.completed_at),
  };
}

export function formatTasksForTool(rows) {
  if (!rows.length) return "No tasks found.";
  return rows
    .map((t) => {
      const due = t.due_at ? new Date(t.due_at).toLocaleString() : "no due date";
      return `• #${t.id} [${t.status}] ${t.title} (due: ${due}, priority: ${t.priority})`;
    })
    .join("\n");
}

export function previewTaskAdd(args) {
  const title = String(args?.title || "Task").trim();
  const due = args?.due_at ? new Date(args.due_at).toLocaleString() : "no due date";
  return `Add task "${title}" (due: ${due})?`;
}

export function previewTaskDelete(args, taskId) {
  const id = Number(args?.task_id ?? taskId);
  return `Delete task #${id}?`;
}
