import { query } from '../db.js';
import { ensureSoul } from '../memory/soul.js';
import { getTelegramLabelsForUserIds } from '../access/telegramAccess.js';

function toIso(v) {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function addEvent(userId, startsAtIso, title) {
  await ensureSoul(userId);
  const titleClean = String(title).trim().slice(0, 500);
  if (!titleClean) throw new Error('Event title is required');
  const r = await query(
    `INSERT INTO events (user_id, starts_at, title) VALUES ($1, $2::timestamptz, $3)
     RETURNING id, starts_at, title`,
    [userId, startsAtIso, titleClean]
  );
  const row = r.rows[0];
  return { id: Number(row.id), starts_at: toIso(row.starts_at), title: row.title };
}

export async function getTodayEvents(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const r = await query(
    `SELECT id, starts_at, title FROM events
     WHERE user_id = $1 AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
     ORDER BY starts_at ASC`,
    [userId, start.toISOString(), end.toISOString()]
  );
  return r.rows;
}

/** @param {string} ymd YYYY-MM-DD (local calendar day) */
export async function getEventsForLocalDate(userId, ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = new Date(y, mo - 1, d);
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) {
    return [];
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const r = await query(
    `SELECT id, starts_at, title FROM events
     WHERE user_id = $1 AND starts_at >= $2::timestamptz AND starts_at < $3::timestamptz
     ORDER BY starts_at ASC`,
    [userId, start.toISOString(), end.toISOString()]
  );
  return r.rows;
}

export async function listAllEvents(limit = 300) {
  const lim = Math.min(2000, Math.max(1, Number(limit) || 300));
  const r = await query(
    `SELECT id, user_id, starts_at, title, created_at FROM events
     ORDER BY starts_at DESC
     LIMIT $1`,
    [lim]
  );
  const labels = await getTelegramLabelsForUserIds(r.rows.map((row) => Number(row.user_id)));
  return r.rows.map((row) => ({
    ...row,
    user_name: labels.get(Number(row.user_id)) || String(row.user_id),
  }));
}

/** @returns {boolean} true if a row was removed */
export async function deleteEventById(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1) return false;
  const r = await query('DELETE FROM events WHERE id = $1', [n]);
  return Number(r.rowCount || 0) > 0;
}

export async function getUpcomingEvents(userId, limit = 10) {
  const now = new Date().toISOString();
  const r = await query(
    `SELECT id, starts_at, title FROM events
     WHERE user_id = $1 AND starts_at >= $2::timestamptz
     ORDER BY starts_at ASC
     LIMIT $3`,
    [userId, now, limit]
  );
  return r.rows;
}
