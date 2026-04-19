import { getDb } from '../db.js';

const MAX_LEN = 50000;

function trim(s) {
  const t = String(s ?? '');
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN)}…` : t;
}

export function appendChatMessage(userId, role, content) {
  const r = String(role).toLowerCase();
  if (r !== 'user' && r !== 'assistant' && r !== 'system') return;
  const db = getDb();
  db.prepare('INSERT INTO chat_log (user_id, role, content) VALUES (?, ?, ?)').run(
    userId,
    r,
    trim(content)
  );
}

export function listChatMessages({ userId = null, limit = 100 } = {}) {
  const db = getDb();
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  if (userId != null && Number.isFinite(Number(userId))) {
    return db
      .prepare(
        `SELECT id, user_id, role, content, created_at FROM chat_log

       WHERE user_id = ?

       ORDER BY id DESC

       LIMIT ?`
      )
      .all(Number(userId), lim)
      .reverse();
  }
  return db
    .prepare(
      `SELECT id, user_id, role, content, created_at FROM chat_log

     ORDER BY id DESC

     LIMIT ?`
    )
    .all(lim)
    .reverse();
}

export function listChatUserIds() {
  const db = getDb();
  const rows = db.prepare(`SELECT DISTINCT user_id FROM chat_log ORDER BY user_id`).all();

  return rows.map((x) => x.user_id);
}

/** Sessions with last activity, newest first. */
export function listChatSessions() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT user_id, MAX(created_at) AS last_at
       FROM chat_log
       GROUP BY user_id
       ORDER BY last_at DESC`
    )
    .all();
  return rows.map((r) => ({ userId: r.user_id, lastAt: r.last_at }));
}
