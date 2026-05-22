import { query } from '../db.js';
import { ensureSoul } from '../memory/soul.js';
import { getTelegramLabelsForUserIds } from '../access/telegramAccess.js';
import {
  listAllOwnedMemorySessions,
  listPortalOwnedUserIds,
  userOwnsMemorySession,
} from '../access/userMemorySessions.js';

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

export async function listEventsForUser(userId, limit = 200) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  const r = await query(
    `SELECT id, user_id, starts_at, title, created_at FROM events
     WHERE user_id = $1
     ORDER BY starts_at DESC
     LIMIT $2`,
    [uid, lim]
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    starts_at: toIso(row.starts_at),
    title: row.title,
    created_at: toIso(row.created_at),
  }));
}

/** Web account + every bot/Telegram session this owner may use (matches chat/memory scope). */
export async function listEventsForOwner(ownerSoulUserId, limit = 200) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];
  const sessions = await listAllOwnedMemorySessions(owner);
  const userIds = [...new Set(sessions.map((s) => Number(s.userId)).filter(Number.isFinite))];
  if (!userIds.length) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  const r = await query(
    `SELECT id, user_id, starts_at, title, created_at FROM events
     WHERE user_id = ANY($1::bigint[])
     ORDER BY starts_at DESC
     LIMIT $2`,
    [userIds, lim]
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    starts_at: toIso(row.starts_at),
    title: row.title,
    created_at: toIso(row.created_at),
  }));
}

/** @returns {boolean} */
export async function deleteEventForUser(userId, eventId) {
  const uid = Number(userId);
  const eid = Number(eventId);
  if (!Number.isFinite(uid) || !Number.isFinite(eid)) return false;
  const r = await query('DELETE FROM events WHERE id = $1 AND user_id = $2', [eid, uid]);
  return Number(r.rowCount || 0) > 0;
}

/** @returns {boolean} */
export async function deleteEventForOwner(ownerSoulUserId, eventId) {
  const eid = Number(eventId);
  if (!Number.isFinite(eid)) return false;
  const probe = await query('SELECT user_id FROM events WHERE id = $1', [eid]);
  const eventUserId = Number(probe.rows[0]?.user_id);
  if (!Number.isFinite(eventUserId)) return false;
  const ok = await userOwnsMemorySession(ownerSoulUserId, eventUserId);
  if (!ok) return false;
  return deleteEventForUser(eventUserId, eid);
}

function mapEventsWithLabels(rows) {
  const labels = getTelegramLabelsForUserIds(rows.map((row) => Number(row.user_id)));
  return labels.then((labelMap) =>
    rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      starts_at: toIso(row.starts_at),
      title: row.title,
      created_at: toIso(row.created_at),
      user_name: labelMap.get(Number(row.user_id)) || String(row.user_id),
    }))
  );
}

export async function listAllEvents(limit = 300) {
  const lim = Math.min(2000, Math.max(1, Number(limit) || 300));
  const r = await query(
    `SELECT id, user_id, starts_at, title, created_at FROM events
     ORDER BY starts_at DESC
     LIMIT $1`,
    [lim]
  );
  return mapEventsWithLabels(r.rows);
}

/** Control panel calendar: admin/Telegram sessions only, not web-portal users. */
export async function listAdminPanelEvents(limit = 300) {
  const exclude = await listPortalOwnedUserIds();
  const lim = Math.min(2000, Math.max(1, Number(limit) || 300));
  const r =
    exclude.length > 0
      ? await query(
          `SELECT id, user_id, starts_at, title, created_at FROM events
           WHERE NOT (user_id = ANY($1::bigint[]))
           ORDER BY starts_at DESC
           LIMIT $2`,
          [exclude, lim]
        )
      : await query(
          `SELECT id, user_id, starts_at, title, created_at FROM events
           ORDER BY starts_at DESC
           LIMIT $1`,
          [lim]
        );
  return mapEventsWithLabels(r.rows);
}

/** @returns {boolean} true if a row was removed */
export async function deleteEventById(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1) return false;
  const r = await query('DELETE FROM events WHERE id = $1', [n]);
  return Number(r.rowCount || 0) > 0;
}

/** Admin delete — refuses portal-user events. */
export async function deleteAdminPanelEvent(eventId) {
  const eid = Number(eventId);
  if (!Number.isFinite(eid) || eid < 1) return false;
  const exclude = new Set(await listPortalOwnedUserIds());
  if (!exclude.size) return deleteEventById(eid);
  const probe = await query('SELECT user_id FROM events WHERE id = $1', [eid]);
  const eventUserId = Number(probe.rows[0]?.user_id);
  if (!Number.isFinite(eventUserId) || exclude.has(eventUserId)) return false;
  return deleteEventById(eid);
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
