import { getDb } from '../db.js';

export function setPending(userId, kind, payload) {
  const db = getDb();
  db.prepare(
    `INSERT INTO pending_confirm (user_id, kind, payload) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, created_at = datetime('now')`
  ).run(userId, kind, JSON.stringify(payload));
}

export function getPending(userId) {
  const db = getDb();
  const row = db.prepare('SELECT kind, payload FROM pending_confirm WHERE user_id = ?').get(userId);
  if (!row) return null;
  try {
    return { kind: row.kind, payload: JSON.parse(row.payload) };
  } catch {
    return null;
  }
}

export function clearPending(userId) {
  const db = getDb();
  db.prepare('DELETE FROM pending_confirm WHERE user_id = ?').run(userId);
}

export function listAllPending() {
  const db = getDb();
  const rows = db.prepare(`SELECT user_id, kind, payload, created_at FROM pending_confirm ORDER BY user_id`).all();
  return rows.map((row) => {
    let payload = row.payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      /* keep string */
    }
    return { user_id: row.user_id, kind: row.kind, payload, created_at: row.created_at };
  });
}
