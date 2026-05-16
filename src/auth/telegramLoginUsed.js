import { query } from '../db.js';

/** Keep replay rows slightly longer than max auth age for cleanup margin. */
const RETENTION_HOURS = 48;

/**
 * Returns true if this Telegram login hash was already consumed.
 */
export async function isTelegramLoginHashUsed(loginHash) {
  const hash = String(loginHash || '').trim().toLowerCase();
  if (!hash) return false;
  const r = await query(`SELECT 1 FROM telegram_login_used WHERE login_hash = $1`, [hash]);
  return r.rows.length > 0;
}

/**
 * Record a consumed login hash (call only after full verification).
 * @returns {boolean} false if hash was already used (race)
 */
export async function recordTelegramLoginHash(loginHash, telegramUserId) {
  const hash = String(loginHash || '').trim().toLowerCase();
  const tid = Number(telegramUserId);
  if (!hash || !Number.isFinite(tid)) return false;
  try {
    await query(
      `INSERT INTO telegram_login_used (login_hash, telegram_user_id) VALUES ($1, $2)`,
      [hash, tid]
    );
    return true;
  } catch (e) {
    if (e?.code === '23505') return false;
    throw e;
  }
}

export async function pruneTelegramLoginUsed() {
  await query(
    `DELETE FROM telegram_login_used
     WHERE used_at < timezone('utc', now()) - ($1::text || ' hours')::interval`,
    [String(RETENTION_HOURS)]
  );
}
