import crypto from 'crypto';
import { query } from '../db.js';

const SESSION_DAYS = 14;
const COOKIE_NAME = 'sena_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function sessionCookieOptions() {
  const secure = process.env.NODE_ENV === 'production' || process.env.SESSION_SECURE === '1';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

/** Options for `clearCookie` — must match attributes used when the cookie was set. */
export function sessionClearCookieOptions() {
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions();
  return { httpOnly, secure, sameSite, path };
}

/**
 * @param {{ role: 'admin'|'user', adminId?: number, soulUserId?: number, telegramUserId?: number }}
 */
export async function createSession({ role, adminId, soulUserId, telegramUserId }) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);

  const r = await query(
    `INSERT INTO web_sessions (token_hash, role, admin_id, soul_user_id, telegram_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      tokenHash,
      role,
      adminId ?? null,
      soulUserId ?? null,
      telegramUserId ?? null,
      expires.toISOString(),
    ]
  );

  return { token, sessionId: r.rows[0].id, expiresAt: expires };
}

export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM web_sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function getSessionByToken(token) {
  if (!token) return null;
  const r = await query(
    `SELECT id, role, admin_id, soul_user_id, telegram_user_id, expires_at
     FROM web_sessions WHERE token_hash = $1`,
    [hashToken(token)]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM web_sessions WHERE id = $1', [row.id]);
    return null;
  }
  return {
    id: row.id,
    role: row.role,
    adminId: row.admin_id != null ? Number(row.admin_id) : null,
    soulUserId: row.soul_user_id != null ? Number(row.soul_user_id) : null,
    telegramUserId: row.telegram_user_id != null ? Number(row.telegram_user_id) : null,
  };
}

/** Remove expired rows (best-effort). */
export async function pruneExpiredSessions() {
  await query(`DELETE FROM web_sessions WHERE expires_at < timezone('utc', now())`);
}
