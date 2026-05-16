import { query } from '../db.js';
import { ensureSoul } from '../memory/soul.js';
import { logger } from '../logger.js';
import {
  normalizeGoogleEmail,
  soulUserIdFromGoogleSub,
} from '../auth/googleOAuth.js';

/** @param {string|null|undefined} raw */
export function normalizeTelegramUsername(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  return s || null;
}

/**
 * @param {{ username?: string|null, telegramUserId?: number|null }} identity
 * @returns {Promise<{ allowed: boolean, row: object|null, reason?: string }>}
 */
export async function checkTelegramAllowlist(identity) {
  const username = normalizeTelegramUsername(identity.username);
  const tid =
    identity.telegramUserId != null && Number.isFinite(Number(identity.telegramUserId))
      ? Number(identity.telegramUserId)
      : null;

  let row = null;
  if (tid != null) {
    const r = await query(
      `SELECT * FROM telegram_allowlist WHERE telegram_user_id = $1 AND status <> 'disabled'`,
      [tid]
    );
    row = r.rows[0] || null;
  }
  if (!row && username) {
    const r = await query(
      `SELECT * FROM telegram_allowlist WHERE LOWER(username) = $1 AND status <> 'disabled'`,
      [username]
    );
    row = r.rows[0] || null;
  }

  if (!row) {
    return {
      allowed: false,
      row: null,
      reason: username
        ? 'not_invited'
        : 'no_username',
    };
  }
  if (row.status === 'disabled') {
    return { allowed: false, row, reason: 'disabled' };
  }
  return { allowed: true, row };
}

/**
 * @param {{ email?: string|null, googleSub?: string|null }} identity
 */
export async function checkGoogleAllowlist(identity) {
  const email = normalizeGoogleEmail(identity.email);
  const sub = String(identity.googleSub ?? '').trim() || null;

  let row = null;
  if (sub) {
    const r = await query(
      `SELECT * FROM telegram_allowlist WHERE google_sub = $1 AND status <> 'disabled'`,
      [sub]
    );
    row = r.rows[0] || null;
  }
  if (!row && email) {
    const r = await query(
      `SELECT * FROM telegram_allowlist WHERE LOWER(email) = $1 AND status <> 'disabled'`,
      [email]
    );
    row = r.rows[0] || null;
  }

  if (!row) {
    return { allowed: false, row: null, reason: 'not_invited' };
  }
  if (row.status === 'disabled') {
    return { allowed: false, row, reason: 'disabled' };
  }
  return { allowed: true, row };
}

/**
 * Bind Google identity on first web login.
 * @param {object} row allowlist row
 * @param {{ sub: string, email?: string, name?: string, picture?: string }} googleUser
 */
export async function activateGoogleAllowlistUser(row, googleUser) {
  const sub = String(googleUser.sub ?? '').trim();
  if (!sub) throw new Error('Invalid Google account');

  const email = normalizeGoogleEmail(googleUser.email);
  const soulUserId =
    row.soul_user_id != null && Number.isFinite(Number(row.soul_user_id))
      ? Number(row.soul_user_id)
      : soulUserIdFromGoogleSub(sub);
  const displayName =
    String(googleUser.name || '').trim() || email || 'Google user';

  await ensureSoul(soulUserId);
  await query(
    `UPDATE soul SET display_name = COALESCE($1, display_name), updated_at = timezone('utc', now())
     WHERE user_id = $2`,
    [displayName, soulUserId]
  );

  await query(
    `UPDATE telegram_allowlist SET
       google_sub = $1,
       email = COALESCE($2, email),
       soul_user_id = $3,
       status = 'active',
       first_login_at = COALESCE(first_login_at, timezone('utc', now())),
       last_seen = timezone('utc', now())
     WHERE id = $4`,
    [sub, email, soulUserId, row.id]
  );

  return { soulUserId, email, googleSub: sub };
}

/**
 * Bind Telegram identity on first use; returns soul_user_id for sessions/bot.
 * @param {object} row allowlist row
 * @param {{ id: number, username?: string, first_name?: string }} telegramUser
 * @param {number|null} [soulUserIdOverride] Bot scoped user id; web login uses Telegram id.
 */
export async function activateAllowlistUser(row, telegramUser, soulUserIdOverride = null) {
  const tid = Number(telegramUser.id);
  if (!Number.isFinite(tid)) throw new Error('Invalid Telegram user id');

  let soulUserId =
    soulUserIdOverride != null && Number.isFinite(Number(soulUserIdOverride))
      ? Number(soulUserIdOverride)
      : row.soul_user_id != null
        ? Number(row.soul_user_id)
        : null;
  if (!Number.isFinite(soulUserId)) {
    soulUserId = tid;
  }

  const username = normalizeTelegramUsername(telegramUser.username) || row.username;
  const displayName =
    String(telegramUser.first_name || '').trim() || username || String(tid);

  await ensureSoul(soulUserId);
  await query(
    `UPDATE soul SET display_name = COALESCE($1, display_name), updated_at = timezone('utc', now())
     WHERE user_id = $2`,
    [displayName, soulUserId]
  );

  await query(
    `UPDATE telegram_allowlist SET
       telegram_user_id = $1,
       username = COALESCE($2, username),
       soul_user_id = $3,
       status = 'active',
       first_login_at = COALESCE(first_login_at, timezone('utc', now())),
       last_seen = timezone('utc', now())
     WHERE id = $4`,
    [tid, username, soulUserId, row.id]
  );

  await query(
    `INSERT INTO telegram_users (user_id, status, username, first_name, last_seen)
     VALUES ($1, 'approved', $2, $3, timezone('utc', now()))
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'approved',
       username = COALESCE(EXCLUDED.username, telegram_users.username),
       first_name = COALESCE(EXCLUDED.first_name, telegram_users.first_name),
       last_seen = timezone('utc', now())`,
    [soulUserId, username, telegramUser.first_name ?? null]
  );

  return { soulUserId, username, telegramUserId: tid };
}

/** Touch last_seen for an active allowlisted user. */
export async function touchAllowlistSeen(telegramUserId, username) {
  const tid = Number(telegramUserId);
  const un = normalizeTelegramUsername(username);
  if (Number.isFinite(tid)) {
    await query(
      `UPDATE telegram_allowlist SET last_seen = timezone('utc', now()), username = COALESCE($1, username)
       WHERE telegram_user_id = $2`,
      [un, tid]
    );
  } else if (un) {
    await query(
      `UPDATE telegram_allowlist SET last_seen = timezone('utc', now()) WHERE LOWER(username) = $1`,
      [un]
    );
  }
}

export async function listAllowlist() {
  const r = await query(
    `SELECT id, username, telegram_user_id, email, google_sub, soul_user_id, status, notes, invited_at, first_login_at, last_seen
     FROM telegram_allowlist
     ORDER BY invited_at DESC`
  );
  return r.rows;
}

/**
 * Admin invites a user by @username and/or numeric Telegram user id.
 */
export async function inviteToAllowlist({ username, telegramUserId, email, notes } = {}) {
  const un = normalizeTelegramUsername(username);
  const em = normalizeGoogleEmail(email);
  const tid =
    telegramUserId != null && String(telegramUserId).trim() !== ''
      ? Number(telegramUserId)
      : null;
  if (!un && !Number.isFinite(tid) && !em) {
    throw new Error('Provide a Google email, Telegram @username, or numeric user id.');
  }

  if (un) {
    const dup = await query(`SELECT id FROM telegram_allowlist WHERE LOWER(username) = $1`, [un]);
    if (dup.rows[0]) throw new Error(`@${un} is already on the invite list.`);
  }
  if (Number.isFinite(tid)) {
    const dup = await query(`SELECT id FROM telegram_allowlist WHERE telegram_user_id = $1`, [tid]);
    if (dup.rows[0]) throw new Error(`Telegram user id ${tid} is already on the invite list.`);
  }
  if (em) {
    const dup = await query(`SELECT id FROM telegram_allowlist WHERE LOWER(email) = $1`, [em]);
    if (dup.rows[0]) throw new Error(`${em} is already on the invite list.`);
  }

  const soulUserId = Number.isFinite(tid) ? tid : null;
  const r = await query(
    `INSERT INTO telegram_allowlist (username, telegram_user_id, email, soul_user_id, status, notes)
     VALUES ($1, $2, $3, $4, 'invited', $5)
     RETURNING *`,
    [
      un,
      Number.isFinite(tid) ? tid : null,
      em,
      soulUserId,
      String(notes ?? '').trim().slice(0, 500),
    ]
  );
  logger.info(`Allowlist invite: @${un || '?'} tid=${tid ?? '?'} email=${em || '?'}`);
  return r.rows[0];
}

export async function setAllowlistStatus(id, status) {
  const sid = Number(id);
  if (!Number.isFinite(sid)) throw new Error('Invalid id');
  const s = ['invited', 'active', 'disabled'].includes(status) ? status : null;
  if (!s) throw new Error('status must be invited, active, or disabled');
  await query(`UPDATE telegram_allowlist SET status = $1 WHERE id = $2`, [s, sid]);
}

export async function updateAllowlistEntry(id, patch) {
  const sid = Number(id);
  if (!Number.isFinite(sid)) throw new Error('Invalid id');
  if (patch.username !== undefined) {
    const un = normalizeTelegramUsername(patch.username);
    if (un) {
      const dup = await query(
        `SELECT id FROM telegram_allowlist WHERE LOWER(username) = $1 AND id <> $2`,
        [un, sid]
      );
      if (dup.rows[0]) throw new Error(`@${un} is already on the invite list.`);
    }
    await query(`UPDATE telegram_allowlist SET username = $1 WHERE id = $2`, [un, sid]);
  }
  if (patch.notes !== undefined) {
    await query(`UPDATE telegram_allowlist SET notes = $1 WHERE id = $2`, [
      String(patch.notes ?? '').trim().slice(0, 500),
      sid,
    ]);
  }
  if (patch.telegramUserId !== undefined) {
    const tid = patch.telegramUserId === '' || patch.telegramUserId == null ? null : Number(patch.telegramUserId);
    if (tid != null && !Number.isFinite(tid)) throw new Error('Invalid Telegram user id');
    await query(`UPDATE telegram_allowlist SET telegram_user_id = $1 WHERE id = $2`, [tid, sid]);
  }
  if (patch.email !== undefined) {
    const em = normalizeGoogleEmail(patch.email);
    if (em) {
      const dup = await query(
        `SELECT id FROM telegram_allowlist WHERE LOWER(email) = $1 AND id <> $2`,
        [em, sid]
      );
      if (dup.rows[0]) throw new Error(`${em} is already on the invite list.`);
    }
    await query(`UPDATE telegram_allowlist SET email = $1 WHERE id = $2`, [em, sid]);
  }
}

export async function deleteAllowlistEntry(id) {
  const sid = Number(id);
  if (!Number.isFinite(sid)) throw new Error('Invalid id');
  await query(`DELETE FROM telegram_allowlist WHERE id = $1`, [sid]);
}

export async function clearAllowlist() {
  await query('DELETE FROM telegram_allowlist');
}
