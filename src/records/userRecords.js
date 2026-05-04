import { getDb } from '../db.js';
import { ensureSoul } from '../memory/soul.js';

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeRecordType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'purchase' || s === 'medicine' || s === 'other') return s;
  if (s === 'note' || s === 'notes') return 'other';
  return 'other';
}

/** @returns {string|null} YYYY-MM-DD or null */
export function normalizeOccurredOn(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return s;
}

/**
 * @param {number} userId
 * @param {{ record_type: string, title: string, occurred_on?: string|null, amount?: number|null, currency?: string|null, notes?: string, meta?: object }} row
 */
export function addUserRecord(userId, row) {
  ensureSoul(userId);
  const record_type = normalizeRecordType(row.record_type);
  const title = String(row.title || '').trim().slice(0, 500);
  if (!title) throw new Error('Title is required');
  const occurred_on = normalizeOccurredOn(row.occurred_on);
  let amount = row.amount;
  if (amount != null && amount !== '') {
    const n = Number(amount);
    amount = Number.isFinite(n) ? n : null;
  } else {
    amount = null;
  }
  const currency = row.currency != null ? String(row.currency).trim().slice(0, 12) || null : null;
  const notes = String(row.notes ?? '').trim().slice(0, 2000);
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const metaStr = JSON.stringify(meta);
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO user_records (user_id, record_type, occurred_on, title, amount, currency, notes, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, record_type, occurred_on, title, amount, currency, notes, metaStr);
  return getUserRecordById(userId, Number(info.lastInsertRowid));
}

export function getUserRecordById(userId, id) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, user_id, record_type, occurred_on, title, amount, currency, notes, meta, created_at
       FROM user_records WHERE user_id = ? AND id = ?`
    )
    .get(userId, id);
}

/**
 * @param {number} userId
 * @param {{ limit?: number, record_type?: string|null }} [opts]
 */
export function listUserRecords(userId, opts = {}) {
  const db = getDb();
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 80));
  const rt = opts.record_type != null && opts.record_type !== '' && opts.record_type !== 'all'
    ? normalizeRecordType(opts.record_type)
    : null;
  if (rt) {
    return db
      .prepare(
        `SELECT id, user_id, record_type, occurred_on, title, amount, currency, notes, meta, created_at
         FROM user_records WHERE user_id = ? AND record_type = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(userId, rt, limit);
  }
  return db
    .prepare(
      `SELECT id, user_id, record_type, occurred_on, title, amount, currency, notes, meta, created_at
       FROM user_records WHERE user_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}

/** @returns {boolean} */
export function deleteUserRecordById(userId, id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1) return false;
  const db = getDb();
  const r = db.prepare('DELETE FROM user_records WHERE user_id = ? AND id = ?').run(userId, n);
  return r.changes > 0;
}

function formatOneRecordLine(r) {
  const meta = safeJsonParse(r.meta, {});
  const parts = [`#${r.id}`, r.record_type];
  if (r.occurred_on) parts.push(String(r.occurred_on));
  parts.push(`"${r.title}"`);
  if (r.amount != null && Number.isFinite(Number(r.amount))) {
    parts.push(`${r.amount}${r.currency ? ' ' + String(r.currency) : ''}`);
  }
  if (meta.schedule) parts.push(`schedule: ${String(meta.schedule)}`);
  if (r.notes) parts.push(`notes: ${String(r.notes).slice(0, 120)}${String(r.notes).length > 120 ? '…' : ''}`);
  return parts.join(' · ');
}

/**
 * Text block for system prompt — exact rows the model should quote for factual answers.
 */
export function formatUserRecordsForPrompt(userId, limit = 45) {
  const rows = listUserRecords(userId, { limit });
  if (!rows.length) return 'No structured records saved yet. (User can ask to save purchases or medicine rows to the table.)';
  return rows.map(formatOneRecordLine).join('\n');
}

export function formatUserRecordsReply(userId, opts = {}) {
  const rows = listUserRecords(userId, { limit: opts.limit ?? 40, record_type: opts.record_type ?? null });
  if (!rows.length) return 'No matching saved rows yet.';
  return `Saved rows (newest first):\n${rows.map(formatOneRecordLine).join('\n')}`;
}
