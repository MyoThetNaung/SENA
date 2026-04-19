import { getConfig } from '../config.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';

const PREVIEW_LEN = 240;

function clip(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_LEN ? t.slice(0, PREVIEW_LEN) + '…' : t;
}

/** Legacy env/settings list: these user IDs are always approved without GUI. */
function legacyAllows(userId) {
  const ids = getConfig().allowedUserIds || [];
  return ids.length > 0 && ids.includes(userId);
}

/**
 * Record/update Telegram user and return access status:
 * 'approved' | 'pending' | 'blocked'
 */
export function touchTelegramUser(userId, from, messagePreview) {
  if (legacyAllows(userId)) {
    const db = getDb();
    const row = db.prepare('SELECT status FROM telegram_users WHERE user_id = ?').get(userId);
    if (!row) {
      db.prepare(
        `INSERT INTO telegram_users (user_id, status, username, first_name, first_message_preview, last_seen)
         VALUES (?, 'approved', ?, ?, ?, datetime('now'))`
      ).run(userId, from?.username ?? null, from?.first_name ?? null, clip(messagePreview));
    } else {
      db.prepare(
        `UPDATE telegram_users SET last_seen = datetime('now'), username = COALESCE(?, username), first_name = COALESCE(?, first_name)
         WHERE user_id = ?`
      ).run(from?.username ?? null, from?.first_name ?? null, userId);
    }
    return 'approved';
  }

  const db = getDb();
  const row = db.prepare('SELECT status FROM telegram_users WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare(
      `INSERT INTO telegram_users (user_id, status, username, first_name, first_message_preview, last_seen)
       VALUES (?, 'pending', ?, ?, ?, datetime('now'))`
    ).run(userId, from?.username ?? null, from?.first_name ?? null, clip(messagePreview));
    logger.info(`Telegram user ${userId} pending approval (@${from?.username || '?'})`);
    return 'pending';
  }

  db.prepare(
    `UPDATE telegram_users SET last_seen = datetime('now'), username = COALESCE(?, username), first_name = COALESCE(?, first_name)
     WHERE user_id = ?`
  ).run(from?.username ?? null, from?.first_name ?? null, userId);
  return row.status;
}

export function setTelegramUserStatus(userId, status) {
  const s = ['approved', 'blocked', 'pending'].includes(status) ? status : 'approved';
  const db = getDb();
  db.prepare(
    `INSERT INTO telegram_users (user_id, status, last_seen) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, last_seen = datetime('now')`
  ).run(userId, s);
}

/** Labels for chat session picker (user ids from chat_log). */
export function getTelegramLabelsForUserIds(userIds) {
  const ids = (userIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return new Map();
  const db = getDb();
  const ph = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT user_id, username, first_name FROM telegram_users WHERE user_id IN (${ph})`)
    .all(...ids);
  const m = new Map();
  for (const r of rows) {
    const label = r.username ? `@${r.username}` : r.first_name || String(r.user_id);
    m.set(r.user_id, label);
  }
  return m;
}

/** Remove all rows (pending / approved / blocked). Next message re-seeds access flow. */
export function clearTelegramAccessRecords() {
  getDb().prepare('DELETE FROM telegram_users').run();
}

export function listTelegramUsers(filterStatus = null) {
  const db = getDb();
  if (filterStatus && ['pending', 'approved', 'blocked'].includes(filterStatus)) {
    return db
      .prepare(
        `SELECT user_id, status, username, first_name, first_message_preview, created_at, last_seen
         FROM telegram_users WHERE status = ? ORDER BY datetime(created_at) DESC`
      )
      .all(filterStatus);
  }
  return db
    .prepare(
      `SELECT user_id, status, username, first_name, first_message_preview, created_at, last_seen
       FROM telegram_users ORDER BY datetime(last_seen) DESC`
    )
    .all();
}
