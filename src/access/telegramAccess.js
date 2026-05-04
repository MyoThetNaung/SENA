import { getDb } from '../db.js';
import { logger } from '../logger.js';

const PREVIEW_LEN = 240;
export const SCOPED_USER_ID_OFFSET = 1_000_000_000_000;

function clip(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_LEN ? t.slice(0, PREVIEW_LEN) + '…' : t;
}

/**
 * Record/update Telegram user and return access status:
 * 'approved' | 'pending' | 'blocked'
 */
export function touchTelegramUser(userId, from, messagePreview, rawTelegramUserId = null) {
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
  syncDisplayNameToSoul(userId);
}

export function syncDisplayNameToSoul(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return;
  const db = getDb();
  let name = null;
  if (uid >= SCOPED_USER_ID_OFFSET) {
    const row = db
      .prepare('SELECT username FROM telegram_identity_map WHERE id = ?')
      .get(uid - SCOPED_USER_ID_OFFSET);
    name = row?.username || null;
  } else {
    const row = db.prepare('SELECT username FROM telegram_users WHERE user_id = ?').get(uid);
    name = row?.username || null;
  }
  db.prepare(
    `INSERT INTO soul (user_id, display_name, preferences, facts)
     VALUES (?, ?, '{}', '[]')
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       updated_at = datetime('now')`
  ).run(uid, name);
}

export function setTelegramUserName(userId, username) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error('Invalid userId');
  const name = String(username ?? '').trim();
  const display = name || null;
  const db = getDb();
  if (uid >= SCOPED_USER_ID_OFFSET) {
    const localMapId = uid - SCOPED_USER_ID_OFFSET;
    db.prepare(
      `UPDATE telegram_identity_map
       SET username = ?, last_seen = datetime('now')
       WHERE id = ?`
    ).run(name || null, localMapId);
  } else {
    db.prepare(
      `INSERT INTO telegram_users (user_id, status, username, last_seen)
       VALUES (?, 'pending', ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         username = excluded.username,
         last_seen = datetime('now')`
    ).run(uid, name || null);
  }
  db.prepare(
    `INSERT INTO soul (user_id, display_name, preferences, facts)
     VALUES (?, ?, '{}', '[]')
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       updated_at = datetime('now')`
  ).run(uid, display);
}

/**
 * Resolve a bot-scoped local session id for a Telegram account.
 * This keeps each bot account isolated even if Telegram user ids overlap.
 */
export function resolveScopedTelegramUserId(botId, from) {
  const bId = Number(botId);
  const tId = Number(from?.id);
  if (!Number.isFinite(bId) || !Number.isFinite(tId)) {
    throw new Error('Invalid Telegram identity');
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO telegram_identity_map (bot_id, telegram_user_id, username, first_name, last_seen)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(bot_id, telegram_user_id) DO UPDATE SET
       username = COALESCE(excluded.username, telegram_identity_map.username),
       first_name = COALESCE(excluded.first_name, telegram_identity_map.first_name),
       last_seen = datetime('now')`
  ).run(bId, tId, from?.username ?? null, from?.first_name ?? null);
  const row = db
    .prepare('SELECT id FROM telegram_identity_map WHERE bot_id = ? AND telegram_user_id = ?')
    .get(bId, tId);
  if (!row?.id) throw new Error('Could not resolve scoped Telegram user id');
  return SCOPED_USER_ID_OFFSET + Number(row.id);
}

export function getBotIdForScopedUserId(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid < SCOPED_USER_ID_OFFSET) return null;
  const localMapId = uid - SCOPED_USER_ID_OFFSET;
  const row = getDb()
    .prepare('SELECT bot_id FROM telegram_identity_map WHERE id = ?')
    .get(localMapId);
  return Number.isFinite(Number(row?.bot_id)) ? Number(row.bot_id) : null;
}

/** Labels for chat session picker (user ids from chat_log). */
export function getTelegramLabelsForUserIds(userIds) {
  const ids = (userIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return new Map();
  const db = getDb();
  const m = new Map();

  const directIds = ids.filter((id) => id < SCOPED_USER_ID_OFFSET);
  if (directIds.length) {
    const ph = directIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT t.user_id, t.username, t.first_name, s.display_name
         FROM telegram_users t
         LEFT JOIN soul s ON s.user_id = t.user_id
         WHERE t.user_id IN (${ph})`
      )
      .all(...directIds);
    for (const r of rows) {
      const label =
        String(r.display_name || '').trim() ||
        String(r.username || '').trim() ||
        String(r.first_name || '').trim() ||
        String(r.user_id);
      m.set(Number(r.user_id), label);
    }
  }

  const scopedIds = ids.filter((id) => id >= SCOPED_USER_ID_OFFSET);
  if (scopedIds.length) {
    const mapIds = scopedIds
      .map((uid) => ({ uid, mapId: uid - SCOPED_USER_ID_OFFSET }))
      .filter((x) => Number.isFinite(x.mapId) && x.mapId >= 1);
    if (mapIds.length) {
      const ph = mapIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT i.id, i.username, i.first_name, s.display_name
           FROM telegram_identity_map i
           LEFT JOIN soul s ON s.user_id = (? + i.id)
           WHERE i.id IN (${ph})`
        )
        .all(SCOPED_USER_ID_OFFSET, ...mapIds.map((x) => x.mapId));
      const byMapId = new Map(rows.map((r) => [Number(r.id), r]));
      for (const item of mapIds) {
        const r = byMapId.get(Number(item.mapId));
        if (!r) continue;
        const label =
          String(r.display_name || '').trim() ||
          String(r.username || '').trim() ||
          String(r.first_name || '').trim() ||
          String(item.uid);
        m.set(Number(item.uid), label);
      }
    }
  }

  for (const uid of ids) {
    if (!m.has(uid)) {
      m.set(uid, String(uid));
    }
  }
  return m;
}

export function listKnownTelegramBots() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT bot_id, COUNT(*) AS users, MAX(last_seen) AS last_seen
       FROM telegram_identity_map
       GROUP BY bot_id
       ORDER BY bot_id`
    )
    .all();
  return rows.map((r) => ({
    botId: Number(r.bot_id),
    users: Number(r.users || 0),
    lastSeen: r.last_seen || null,
  }));
}

/** Remove all rows (pending / approved / blocked). Next message re-seeds access flow. */
export function clearTelegramAccessRecords() {
  const db = getDb();
  db.prepare('DELETE FROM telegram_users').run();
  db.prepare('DELETE FROM telegram_identity_map').run();
}

export function listTelegramUsers(filterStatus = null) {
  const db = getDb();
  if (filterStatus && ['pending', 'approved', 'blocked'].includes(filterStatus)) {
    return db
      .prepare(
        `SELECT t.user_id, t.status, t.username, t.first_name, t.first_message_preview, t.created_at, t.last_seen, s.display_name
         FROM telegram_users t
         LEFT JOIN soul s ON s.user_id = t.user_id
         WHERE t.status = ?
         ORDER BY datetime(t.created_at) DESC`
      )
      .all(filterStatus);
  }
  return db
    .prepare(
      `SELECT t.user_id, t.status, t.username, t.first_name, t.first_message_preview, t.created_at, t.last_seen, s.display_name
       FROM telegram_users t
       LEFT JOIN soul s ON s.user_id = t.user_id
       ORDER BY datetime(t.last_seen) DESC`
    )
    .all();
}
