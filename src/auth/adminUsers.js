import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { logger } from '../logger.js';

const ROUNDS = 12;

export async function findAdminByEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e) return null;
  const r = await query('SELECT id, email, password_hash FROM app_admins WHERE LOWER(email) = $1', [e]);
  return r.rows[0] || null;
}

export async function verifyAdminPassword(email, password) {
  const row = await findAdminByEmail(email);
  if (!row) return null;
  const ok = await bcrypt.compare(String(password || ''), row.password_hash);
  if (!ok) return null;
  return { id: Number(row.id), email: row.email };
}

export async function createAdmin(email, password) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !String(email).includes('@')) throw new Error('Valid email is required');
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const hash = await bcrypt.hash(String(password), ROUNDS);
  const r = await query(
    `INSERT INTO app_admins (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
    [e, hash]
  );
  return { id: Number(r.rows[0].id), email: r.rows[0].email };
}

export async function countAdmins() {
  const r = await query('SELECT COUNT(*)::int AS c FROM app_admins');
  return Number(r.rows[0]?.c || 0);
}

/**
 * Create first admin from env when table is empty.
 * @param {(text: string, params?: unknown[]) => Promise<import('pg').QueryResult>} [runQuery]
 *   Use during DB init to avoid re-entering getPool() (deadlock).
 */
export async function bootstrapAdminFromEnv(runQuery = query) {
  const countR = await runQuery('SELECT COUNT(*)::int AS c FROM app_admins');
  const n = Number(countR.rows[0]?.c || 0);
  if (n > 0) return false;

  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) {
    logger.warn(
      'No app_admins row and ADMIN_EMAIL/ADMIN_PASSWORD unset — admin login disabled until configured'
    );
    return false;
  }

  const e = email.toLowerCase();
  if (!e.includes('@')) throw new Error('Valid email is required');
  if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
  const hash = await bcrypt.hash(String(password), ROUNDS);
  await runQuery(`INSERT INTO app_admins (email, password_hash) VALUES ($1, $2)`, [e, hash]);
  logger.info(`Bootstrap admin created for ${email}`);
  return true;
}
