import { query } from '../db.js';
import { getAllowlistBySoulUserId, normalizeTelegramUsername } from './telegramAllowlist.js';
import { getOwnerSoulUserIdForBotId } from './userTelegramBots.js';
import { syncDisplayNameToSoul } from './telegramAccess.js';

/**
 * Access gate for bots registered to a web user (not global admin allowlist).
 * @returns {'approved'|'blocked'|'no_username'}
 */
export async function gateUserOwnedBotAccess(botId, from, messagePreview, scopedSoulUserId) {
  const ownerSoulUserId = await getOwnerSoulUserIdForBotId(botId);
  if (ownerSoulUserId == null) return 'blocked';

  const username = normalizeTelegramUsername(from?.username);
  const telegramUserId = from?.id != null ? Number(from.id) : null;
  const scopedId = Number(scopedSoulUserId);

  if (!username && !Number.isFinite(telegramUserId)) {
    return 'no_username';
  }

  const ownerAllow = await getAllowlistBySoulUserId(ownerSoulUserId);
  const ownerTid =
    ownerAllow?.telegram_user_id != null && Number.isFinite(Number(ownerAllow.telegram_user_id))
      ? Number(ownerAllow.telegram_user_id)
      : null;
  if (ownerTid != null && Number.isFinite(telegramUserId) && ownerTid === telegramUserId) {
    await upsertUserBotAccess({
      ownerSoulUserId,
      botId,
      scopedUserId: scopedId,
      telegramUserId,
      username,
      firstName: from?.first_name,
      preview: messagePreview,
      status: 'approved',
    });
    return 'approved';
  }

  const existing = await query(
    `SELECT id, status FROM user_bot_access
     WHERE owner_soul_user_id = $1 AND bot_id = $2 AND scoped_user_id = $3`,
    [ownerSoulUserId, botId, scopedId]
  );
  const row = existing.rows[0];

  if (row?.status === 'approved') {
    await touchUserBotAccessRow(Number(row.id), { username, firstName: from?.first_name });
    await syncDisplayNameToSoul(scopedId);
    return 'approved';
  }

  if (row?.status === 'blocked') {
    return 'blocked';
  }

  if (row?.status === 'pending') {
    await touchUserBotAccessRow(Number(row.id), { username, firstName: from?.first_name });
    return 'blocked';
  }

  await upsertUserBotAccess({
    ownerSoulUserId,
    botId,
    scopedUserId: scopedId,
    telegramUserId,
    username,
    firstName: from?.first_name,
    preview: messagePreview,
    status: 'pending',
  });
  return 'blocked';
}

async function upsertUserBotAccess({
  ownerSoulUserId,
  botId,
  scopedUserId,
  telegramUserId,
  username,
  firstName,
  preview,
  status,
}) {
  await query(
    `INSERT INTO user_bot_access (
       owner_soul_user_id, bot_id, scoped_user_id, telegram_user_id, username, first_name,
       first_message_preview, status, last_seen
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, timezone('utc', now()))
     ON CONFLICT (owner_soul_user_id, bot_id, scoped_user_id) DO UPDATE SET
       telegram_user_id = COALESCE(EXCLUDED.telegram_user_id, user_bot_access.telegram_user_id),
       username = COALESCE(EXCLUDED.username, user_bot_access.username),
       first_name = COALESCE(EXCLUDED.first_name, user_bot_access.first_name),
       first_message_preview = COALESCE(user_bot_access.first_message_preview, EXCLUDED.first_message_preview),
       status = CASE
         WHEN user_bot_access.status = 'approved' THEN user_bot_access.status
         WHEN user_bot_access.status = 'blocked' THEN user_bot_access.status
         ELSE EXCLUDED.status
       END,
       last_seen = timezone('utc', now())`,
    [
      ownerSoulUserId,
      botId,
      scopedUserId,
      Number.isFinite(telegramUserId) ? telegramUserId : null,
      username,
      firstName ?? null,
      String(preview ?? '').slice(0, 500),
      status,
    ]
  );
  if (status === 'approved') {
    await syncDisplayNameToSoul(scopedUserId);
  }
}

async function touchUserBotAccessRow(id, { username, firstName }) {
  await query(
    `UPDATE user_bot_access SET
       username = COALESCE($1, username),
       first_name = COALESCE($2, first_name),
       last_seen = timezone('utc', now())
     WHERE id = $3`,
    [username, firstName ?? null, id]
  );
}

export async function listBotAccessForOwner(ownerSoulUserId, filterStatus = null) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];

  if (filterStatus && ['pending', 'approved', 'blocked'].includes(filterStatus)) {
    const r = await query(
      `SELECT a.id, a.bot_id, a.scoped_user_id, a.telegram_user_id, a.username, a.first_name,
              a.first_message_preview, a.status, a.created_at, a.last_seen,
              b.bot_username
       FROM user_bot_access a
       LEFT JOIN user_telegram_bots b ON b.owner_soul_user_id = a.owner_soul_user_id AND b.bot_id = a.bot_id
       WHERE a.owner_soul_user_id = $1 AND a.status = $2
       ORDER BY a.last_seen DESC`,
      [owner, filterStatus]
    );
    return r.rows;
  }

  const r = await query(
    `SELECT a.id, a.bot_id, a.scoped_user_id, a.telegram_user_id, a.username, a.first_name,
            a.first_message_preview, a.status, a.created_at, a.last_seen,
            b.bot_username
     FROM user_bot_access a
     LEFT JOIN user_telegram_bots b ON b.owner_soul_user_id = a.owner_soul_user_id AND b.bot_id = a.bot_id
     WHERE a.owner_soul_user_id = $1
     ORDER BY a.last_seen DESC`,
    [owner]
  );
  return r.rows;
}

export async function setBotAccessStatusForOwner(ownerSoulUserId, accessId, status) {
  const owner = Number(ownerSoulUserId);
  const id = Number(accessId);
  const s = ['pending', 'approved', 'blocked'].includes(status) ? status : null;
  if (!Number.isFinite(owner) || !Number.isFinite(id) || !s) {
    throw new Error('Invalid access update');
  }

  const r = await query(
    `UPDATE user_bot_access SET status = $1, last_seen = timezone('utc', now())
     WHERE id = $2 AND owner_soul_user_id = $3
     RETURNING scoped_user_id`,
    [s, id, owner]
  );
  if (!r.rows[0]) throw new Error('Access request not found.');

  if (s === 'approved') {
    await syncDisplayNameToSoul(Number(r.rows[0].scoped_user_id));
  }
  return { ok: true };
}
