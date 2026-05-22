import crypto from 'crypto';
import { query } from '../db.js';
import { getConfig } from '../config.js';

const SESSION_DAYS = 14;
const COOKIE_NAME = 'sena_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicAccessProtocol() {
  const pub = String(getConfig().senaPublicAccessUrl ?? process.env.SENA_PUBLIC_ACCESS_URL ?? '').trim();
  if (!pub) return null;
  try {
    return new URL(pub.includes('://') ? pub : `http://${pub}`).protocol;
  } catch {
    return null;
  }
}

/**
 * Whether session cookies should use the Secure flag.
 * Do not tie this to NODE_ENV alone — production Next builds often run on plain HTTP (DDNS/LAN).
 * @param {import('express').Request} [req]
 */
export function isHttpsContext(req) {
  const forced = String(process.env.SESSION_SECURE ?? '').trim();
  if (forced === '1') return true;
  if (forced === '0') return false;

  const fromConfig = publicAccessProtocol();
  if (fromConfig === 'https:') return true;
  if (fromConfig === 'http:') return false;

  if (req) {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (proto === 'https') return true;
    if (proto === 'http') return false;
  }

  return false;
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

/** @param {import('express').Request} [req] */
export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isHttpsContext(req),
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

/** @param {import('express').Request} [req] */
export function sessionClearCookieOptions(req) {
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions(req);
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
