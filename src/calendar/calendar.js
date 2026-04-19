import { getDb } from '../db.js';
import { ensureSoul } from '../memory/soul.js';

export function addEvent(userId, startsAtIso, title) {
  ensureSoul(userId);
  const db = getDb();
  const titleClean = String(title).trim().slice(0, 500);
  if (!titleClean) throw new Error('Event title is required');
  const info = db
    .prepare(
      `INSERT INTO events (user_id, starts_at, title) VALUES (?, ?, ?)`
    )
    .run(userId, startsAtIso, titleClean);
  return { id: Number(info.lastInsertRowid), starts_at: startsAtIso, title: titleClean };
}

export function getTodayEvents(userId) {
  const db = getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = db
    .prepare(
      `SELECT id, starts_at, title FROM events
       WHERE user_id = ? AND starts_at >= ? AND starts_at < ?
       ORDER BY starts_at ASC`
    )
    .all(userId, start.toISOString(), end.toISOString());
  return rows;
}

export function listAllEvents(limit = 300) {
  const db = getDb();
  const lim = Math.min(2000, Math.max(1, Number(limit) || 300));
  return db
    .prepare(
      `SELECT id, user_id, starts_at, title, created_at FROM events
       ORDER BY starts_at DESC
       LIMIT ?`
    )
    .all(lim);
}

export function getUpcomingEvents(userId, limit = 10) {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT id, starts_at, title FROM events
       WHERE user_id = ? AND starts_at >= ?
       ORDER BY starts_at ASC
       LIMIT ?`
    )
    .all(userId, now, limit);
  return rows;
}
