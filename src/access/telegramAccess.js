import { query } from '../db.js';
import { gateTelegramAccess } from './telegramAccessGate.js';

export const SCOPED_USER_ID_OFFSET = 1_000_000_000_000;

/**
 * Invite-only access check (admin must add @username or user id first).
 * @returns {'approved'|'blocked'|'no_username'}
 */
export async function touchTelegramUser(userId, from, messagePreview, rawTelegramUserId = null) {
  void messagePreview;
  void rawTelegramUserId;
  return gateTelegramAccess(from, messagePreview, userId);
}

export async function setTelegramUserStatus(userId, status) {
  const s = ['approved', 'blocked', 'pending'].includes(status) ? status : 'approved';
  await query(
    `INSERT INTO telegram_users (user_id, status, last_seen) VALUES ($1, $2, timezone('utc', now()))
     ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, last_seen = timezone('utc', now())`,
    [userId, s]
  );
  await syncDisplayNameToSoul(userId);
}

export async function syncDisplayNameToSoul(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return;
  let name = null;
  if (uid >= SCOPED_USER_ID_OFFSET) {
    const r = await query('SELECT username FROM telegram_identity_map WHERE id = $1', [uid - SCOPED_USER_ID_OFFSET]);
    name = r.rows[0]?.username || null;
  } else {
    const r = await query('SELECT username FROM telegram_users WHERE user_id = $1', [uid]);
    name = r.rows[0]?.username || null;
  }
  await query(
    `INSERT INTO soul (user_id, display_name, preferences, facts)
     VALUES ($1, $2, '{}', '[]')
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       updated_at = timezone('utc', now())`,
    [uid, name]
  );
}

export async function setTelegramUserName(userId, username) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error('Invalid userId');
  const name = String(username ?? '').trim();
  const display = name || null;
  if (uid >= SCOPED_USER_ID_OFFSET) {
    const localMapId = uid - SCOPED_USER_ID_OFFSET;
    await query(
      `UPDATE telegram_identity_map
       SET username = $1, last_seen = timezone('utc', now())
       WHERE id = $2`,
      [name || null, localMapId]
    );
  } else {
    await query(
      `INSERT INTO telegram_users (user_id, status, username, last_seen)
       VALUES ($1, 'pending', $2, timezone('utc', now()))
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         last_seen = timezone('utc', now())`,
      [uid, name || null]
    );
  }
  await query(
    `INSERT INTO soul (user_id, display_name, preferences, facts)
     VALUES ($1, $2, '{}', '[]')
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       updated_at = timezone('utc', now())`,
    [uid, display]
  );
}

/**
 * Resolve a bot-scoped local session id for a Telegram account.
 * This keeps each bot account isolated even if Telegram user ids overlap.
 */
export async function resolveScopedTelegramUserId(botId, from) {
  const bId = Number(botId);
  const tId = Number(from?.id);
  if (!Number.isFinite(bId) || !Number.isFinite(tId)) {
    throw new Error('Invalid Telegram identity');
  }
  await query(
    `INSERT INTO telegram_identity_map (bot_id, telegram_user_id, username, first_name, last_seen)
     VALUES ($1, $2, $3, $4, timezone('utc', now()))
     ON CONFLICT (bot_id, telegram_user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, telegram_identity_map.username),
       first_name = COALESCE(EXCLUDED.first_name, telegram_identity_map.first_name),
       last_seen = timezone('utc', now())`,
    [bId, tId, from?.username ?? null, from?.first_name ?? null]
  );
  const r = await query('SELECT id FROM telegram_identity_map WHERE bot_id = $1 AND telegram_user_id = $2', [
    bId,
    tId,
  ]);
  const row = r.rows[0];
  if (!row?.id) throw new Error('Could not resolve scoped Telegram user id');
  return SCOPED_USER_ID_OFFSET + Number(row.id);
}

export async function getBotIdForScopedUserId(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid < SCOPED_USER_ID_OFFSET) return null;
  const localMapId = uid - SCOPED_USER_ID_OFFSET;
  const r = await query('SELECT bot_id FROM telegram_identity_map WHERE id = $1', [localMapId]);
  const row = r.rows[0];
  return Number.isFinite(Number(row?.bot_id)) ? Number(row.bot_id) : null;
}

/** Labels for chat session picker (user ids from chat_log). */
export async function getTelegramLabelsForUserIds(userIds) {
  const ids = (userIds || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return new Map();
  const m = new Map();

  const directIds = ids.filter((id) => id < SCOPED_USER_ID_OFFSET);
  if (directIds.length) {
    const ph = directIds.map((_, i) => `$${i + 1}`).join(',');
    const r = await query(
      `SELECT t.user_id, t.username, t.first_name, s.display_name
       FROM telegram_users t
       LEFT JOIN soul s ON s.user_id = t.user_id
       WHERE t.user_id IN (${ph})`,
      directIds
    );
    for (const row of r.rows) {
      const label =
        String(row.display_name || '').trim() ||
        String(row.username || '').trim() ||
        String(row.first_name || '').trim() ||
        String(row.user_id);
      m.set(Number(row.user_id), label);
    }
  }

  const scopedIds = ids.filter((id) => id >= SCOPED_USER_ID_OFFSET);
  if (scopedIds.length) {
    const mapIds = scopedIds
      .map((uid) => ({ uid, mapId: uid - SCOPED_USER_ID_OFFSET }))
      .filter((x) => Number.isFinite(x.mapId) && x.mapId >= 1);
    if (mapIds.length) {
      const ph = mapIds.map((_, i) => `$${i + 2}`).join(',');
      const r = await query(
        `SELECT i.id, i.username, i.first_name, s.display_name
         FROM telegram_identity_map i
         LEFT JOIN soul s ON s.user_id = ($1 + i.id)
         WHERE i.id IN (${ph})`,
        [SCOPED_USER_ID_OFFSET, ...mapIds.map((x) => x.mapId)]
      );
      const byMapId = new Map(r.rows.map((row) => [Number(row.id), row]));
      for (const item of mapIds) {
        const row = byMapId.get(Number(item.mapId));
        if (!row) continue;
        const label =
          String(row.display_name || '').trim() ||
          String(row.username || '').trim() ||
          String(row.first_name || '').trim() ||
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

export async function listKnownTelegramBots() {
  const r = await query(
    `SELECT bot_id, COUNT(*)::int AS users, MAX(last_seen) AS last_seen
     FROM telegram_identity_map
     GROUP BY bot_id
     ORDER BY bot_id`
  );
  return r.rows.map((row) => ({
    botId: Number(row.bot_id),
    users: Number(row.users || 0),
    lastSeen: row.last_seen || null,
  }));
}

/** Remove all rows (pending / approved / blocked). Next message re-seeds access flow. */
export async function clearTelegramAccessRecords() {
  await query('DELETE FROM telegram_users');
  await query('DELETE FROM telegram_identity_map');
}

export async function listTelegramUsers(filterStatus = null) {
  if (filterStatus && ['pending', 'approved', 'blocked'].includes(filterStatus)) {
    const r = await query(
      `SELECT t.user_id, t.status, t.username, t.first_name, t.first_message_preview, t.created_at, t.last_seen, s.display_name
       FROM telegram_users t
       LEFT JOIN soul s ON s.user_id = t.user_id
       WHERE t.status = $1
       ORDER BY t.created_at DESC`,
      [filterStatus]
    );
    return r.rows;
  }
  const r = await query(
    `SELECT t.user_id, t.status, t.username, t.first_name, t.first_message_preview, t.created_at, t.last_seen, s.display_name
     FROM telegram_users t
     LEFT JOIN soul s ON s.user_id = t.user_id
     ORDER BY t.last_seen DESC`
  );
  return r.rows;
}
