import { query } from '../db.js';
import { rowTimestampToIsoZ } from '../util/dbTime.js';
import { SCOPED_USER_ID_OFFSET } from './telegramAccess.js';
import { getTelegramLabelsForUserIds } from './telegramAccess.js';
import { getAllowlistBySoulUserId } from './telegramAllowlist.js';
import { listBotsForOwner, getOwnerSoulUserIdForBotId } from './userTelegramBots.js';

/**
 * Telegram bots the logged-in user owns (for Memory bot tabs).
 */
export async function listUserMemoryBots(ownerSoulUserId) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];

  const byBotId = new Map();

  try {
    const rows = await listBotsForOwner(owner);
    for (const b of rows) {
      byBotId.set(b.botId, {
        botId: b.botId,
        username: b.botUsername || null,
        tokenMasked: b.tokenMasked,
      });
    }
  } catch {
    /* user_telegram_bots table may not exist until migration runs */
  }

  try {
    const accessR = await query(
      `SELECT DISTINCT a.bot_id, utb.bot_username, utb.bot_token
       FROM user_bot_access a
       LEFT JOIN user_telegram_bots utb
         ON utb.owner_soul_user_id = a.owner_soul_user_id AND utb.bot_id = a.bot_id
       WHERE a.owner_soul_user_id = $1`,
      [owner]
    );
    for (const row of accessR.rows) {
    const bid = Number(row.bot_id);
    if (!Number.isFinite(bid) || byBotId.has(bid)) continue;
      byBotId.set(bid, {
        botId: bid,
        username: row.bot_username || null,
        tokenMasked: row.bot_token ? `${String(row.bot_token).slice(0, 4)}...` : null,
      });
    }
  } catch {
    /* tables may not exist until migration */
  }

  try {
  const chatR = await query(
    `SELECT DISTINCT m.bot_id
     FROM chat_log c
     JOIN telegram_identity_map m ON m.id = (c.user_id - $1)
     JOIN user_telegram_bots utb ON utb.bot_id = m.bot_id AND utb.owner_soul_user_id = $2
     WHERE c.user_id >= $1`,
    [SCOPED_USER_ID_OFFSET, owner]
  );
  for (const row of chatR.rows) {
    const bid = Number(row.bot_id);
    if (!Number.isFinite(bid) || byBotId.has(bid)) continue;
    const probe = await query(
      `SELECT bot_username FROM user_telegram_bots WHERE owner_soul_user_id = $1 AND bot_id = $2`,
      [owner, bid]
    );
    byBotId.set(bid, {
      botId: bid,
      username: probe.rows[0]?.bot_username || null,
      tokenMasked: null,
    });
  }
  } catch {
    /* ignore */
  }

  return [...byBotId.values()].sort((a, b) => a.botId - b.botId);
}

async function listScopedSessionsForBot(botId) {
  const bid = Number(botId);
  if (!Number.isFinite(bid)) return [];

  const byUserId = new Map();

  const r = await query(
    `SELECT m.id, m.telegram_user_id, m.username, m.first_name, m.last_seen
     FROM telegram_identity_map m
     WHERE m.bot_id = $1
     ORDER BY m.last_seen DESC NULLS LAST, m.id`,
    [bid]
  );
  for (const row of r.rows) {
    const scopedUserId = SCOPED_USER_ID_OFFSET + Number(row.id);
    if (!Number.isFinite(scopedUserId)) continue;
    const label =
      String(row.username || '').trim() ||
      String(row.first_name || '').trim() ||
      (row.telegram_user_id != null ? `Telegram ${row.telegram_user_id}` : `Session ${scopedUserId}`);
    byUserId.set(scopedUserId, {
      userId: scopedUserId,
      label: label.startsWith('@') ? label : row.username ? `@${row.username}` : label,
      scoped: true,
      botId: bid,
    });
  }

  const chatR = await query(
    `SELECT c.user_id, MAX(c.created_at) AS last_at
     FROM chat_log c
     JOIN telegram_identity_map m ON m.id = (c.user_id - $1) AND m.bot_id = $2
     WHERE c.user_id >= $1
     GROUP BY c.user_id
     ORDER BY last_at DESC`,
    [SCOPED_USER_ID_OFFSET, bid]
  );
  for (const row of chatR.rows) {
    const uid = Number(row.user_id);
    if (!Number.isFinite(uid)) continue;
    if (!byUserId.has(uid)) {
      byUserId.set(uid, {
        userId: uid,
        label: `Chat session ${uid}`,
        scoped: true,
        botId: bid,
      });
    }
  }

  const sessions = [...byUserId.values()];
  const ids = sessions.map((s) => s.userId);
  if (ids.length) {
    const labels = await getTelegramLabelsForUserIds(ids);
    for (const s of sessions) {
      const better = labels.get(s.userId);
      if (better) s.label = better;
    }
  }
  return sessions;
}

/** Chat + memory session list with last message time. */
export async function listUserChatSessions(ownerSoulUserId, botId = null) {
  const sessions = await listUserMemorySessions(ownerSoulUserId, botId);
  const ids = sessions.map((s) => s.userId).filter((id) => Number.isFinite(id));
  if (!ids.length) return sessions;

  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  const r = await query(
    `SELECT user_id, MAX(created_at) AS last_at
     FROM chat_log
     WHERE user_id IN (${ph})
     GROUP BY user_id`,
    ids
  );
  const lastByUser = new Map(
    r.rows.map((row) => [Number(row.user_id), rowTimestampToIsoZ(row.last_at)])
  );
  return sessions
    .map((s) => ({ ...s, lastAt: lastByUser.get(s.userId) || null }))
    .sort((a, b) => {
      const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return tb - ta;
    });
}

/**
 * Sessions for Memory UI when a bot tab is selected (null = web account only).
 */
export async function listUserMemorySessions(ownerSoulUserId, botId = null) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];

  const bid =
    botId != null && botId !== '' && String(botId).toLowerCase() !== 'web' ? Number(botId) : null;

  if (!Number.isFinite(bid)) {
    return [
      {
        userId: owner,
        label: 'Web account',
        scoped: false,
        botId: null,
      },
    ];
  }

  const botOwner = await getOwnerSoulUserIdForBotId(bid);
  if (botOwner !== owner) {
    throw new Error('That bot is not on your account.');
  }

  return listScopedSessionsForBot(bid);
}

/**
 * Every session id this user may read or edit in Memory (web + own bots + own Telegram chats elsewhere).
 */
export async function listAllOwnedMemorySessions(ownerSoulUserId) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];

  const byUserId = new Map();
  const add = (s) => {
    if (s && Number.isFinite(s.userId) && !byUserId.has(s.userId)) {
      byUserId.set(s.userId, s);
    }
  };

  add({ userId: owner, label: 'Web account', scoped: false, botId: null });

  const ownedBots = await listUserMemoryBots(owner);
  for (const b of ownedBots) {
    for (const s of await listScopedSessionsForBot(b.botId)) {
      add(s);
    }
  }

  const allow = await getAllowlistBySoulUserId(owner);
  const tid =
    allow?.telegram_user_id != null && Number.isFinite(Number(allow.telegram_user_id))
      ? Number(allow.telegram_user_id)
      : null;
  if (tid != null) {
    const ownedBotIds = new Set(ownedBots.map((b) => b.botId));
    const r = await query(
      `SELECT id, bot_id, username, first_name, last_seen
       FROM telegram_identity_map
       WHERE telegram_user_id = $1
       ORDER BY last_seen DESC NULLS LAST, id`,
      [tid]
    );
    for (const row of r.rows) {
      const bid = Number(row.bot_id);
      if (ownedBotIds.has(bid)) continue;
      const scopedUserId = SCOPED_USER_ID_OFFSET + Number(row.id);
      if (!Number.isFinite(scopedUserId)) continue;
      const label =
        `Telegram bot ${bid}` +
        (row.username ? ` — @${row.username}` : row.first_name ? ` — ${row.first_name}` : '');
      add({ userId: scopedUserId, label, scoped: true, botId: bid });
    }
  }

  return [...byUserId.values()];
}

export async function userOwnsMemorySession(ownerSoulUserId, sessionUserId) {
  const owner = Number(ownerSoulUserId);
  const uid = Number(sessionUserId);
  if (!Number.isFinite(owner) || !Number.isFinite(uid)) return false;
  const all = await listAllOwnedMemorySessions(owner);
  return all.some((s) => s.userId === uid);
}

/** Soul ids for web-portal accounts (own bots / user sessions). */
export async function listPortalOwnerSoulIds() {
  const ids = new Set();
  try {
    const r = await query(
      `SELECT DISTINCT owner_soul_user_id AS id FROM user_telegram_bots
       UNION
       SELECT DISTINCT soul_user_id AS id FROM web_sessions
         WHERE role = 'user' AND soul_user_id IS NOT NULL
       UNION
       SELECT DISTINCT owner_soul_user_id AS id FROM user_bot_access`
    );
    for (const row of r.rows) {
      const id = Number(row.id);
      if (Number.isFinite(id)) ids.add(id);
    }
  } catch {
    /* tables may not exist until migration */
  }
  return [...ids];
}

/** Every chat/session user id owned by a portal account (excluded from admin calendar). */
export async function listPortalOwnedUserIds() {
  const out = new Set();
  for (const owner of await listPortalOwnerSoulIds()) {
    for (const s of await listAllOwnedMemorySessions(owner)) {
      out.add(s.userId);
    }
  }
  return [...out];
}
