import { query } from '../db.js';
import { rowTimestampToIsoZ } from '../util/dbTime.js';

const MAX_LEN = 50000;

function trim(s) {
  const t = String(s ?? '');
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN)}…` : t;
}

export async function appendChatMessage(userId, role, content) {
  const r = String(role).toLowerCase();
  if (r !== 'user' && r !== 'assistant' && r !== 'system') return;
  const createdAt = new Date().toISOString();
  await query(
    'INSERT INTO chat_log (user_id, role, content, created_at) VALUES ($1, $2, $3, $4::timestamptz)',
    [userId, r, trim(content), createdAt]
  );
}

function mapChatRow(row) {
  return {
    ...row,
    created_at: rowTimestampToIsoZ(row.created_at),
  };
}

export async function listChatMessages({ userId = null, limit = 100 } = {}) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  let rows;
  if (userId != null && Number.isFinite(Number(userId))) {
    const r = await query(
      `SELECT id, user_id, role, content, created_at FROM chat_log
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [Number(userId), lim]
    );
    rows = r.rows;
  } else {
    const r = await query(
      `SELECT id, user_id, role, content, created_at FROM chat_log
       ORDER BY id DESC
       LIMIT $1`,
      [lim]
    );
    rows = r.rows;
  }
  return [...rows].reverse().map(mapChatRow);
}

export async function listChatUserIds() {
  const r = await query(`SELECT DISTINCT user_id FROM chat_log ORDER BY user_id`);
  return r.rows.map((x) => Number(x.user_id));
}

/** Sessions with last activity, newest first. */
export async function listChatSessions() {
  const r = await query(
    `SELECT user_id, MAX(created_at) AS last_at
     FROM chat_log
     GROUP BY user_id
     ORDER BY last_at DESC`
  );
  return r.rows.map((row) => ({
    userId: Number(row.user_id),
    lastAt: row.last_at != null ? rowTimestampToIsoZ(row.last_at) : row.last_at,
  }));
}

/** Remove all chat rows for one session user id. */
export async function clearChatMessagesForUser(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error('Invalid userId');
  const r = await query('DELETE FROM chat_log WHERE user_id = $1', [uid]);
  return Number(r.rowCount || 0);
}
