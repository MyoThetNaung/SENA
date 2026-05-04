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
  if (s === 'purchase' || s === 'medicine' || s === 'other' || s === 'sale') return s;
  if (s === 'sold' || s === 'use' || s === 'usage' || s === 'consumption' || s === 'adjustment') return 'sale';
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

function normalizeTitleKey(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bstartlink\b/gi, 'starlink');
}

function amountFingerprintPart(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

/** Serial-like tokens (Starlink M1HT…, etc.) for de-duplication. */
function extractSerialBlob(text) {
  const s = String(text || '');
  const m = s.match(/\b(M\d[A-Z]{2}\d{6,})\b/i);
  return m ? m[0].toUpperCase() : '';
}

/** DD.MM.YY or DD.MM.YYYY from pasted line text when ISO missing. */
function sniffEuropeanDateFromBlob(blob) {
  const m = String(blob || '').match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return normalizeOccurredOn(iso);
}

export function fingerprintForBulkLine(it, defaultOccurredOn) {
  const blob = `${it.title || ''}\n${it.notes || ''}\n${it.subtype || ''}\n${it.quantity_label || ''}`;
  const on =
    normalizeOccurredOn(it.occurred_on) ||
    sniffEuropeanDateFromBlob(blob) ||
    normalizeOccurredOn(defaultOccurredOn) ||
    '';
  const title = normalizeTitleKey(it.title);
  const amtRaw = it.line_total != null ? it.line_total : it.amount;
  const amt = amountFingerprintPart(amtRaw);
  const serial = extractSerialBlob(blob) || extractSerialBlob(it.title);
  const movement = String(it.movement || it.record_type || 'purchase').toLowerCase();
  const isSale = movement === 'sale' || movement === 'sold' || movement === 'use';
  const qty = it.quantity != null && Number.isFinite(Number(it.quantity)) ? Number(it.quantity) : '';
  const qtyPart = isSale && qty !== '' ? `s${Math.abs(qty)}` : qty !== '' ? `p${Math.abs(qty)}` : '';
  return `${on}|${title}|${amt}|${serial}|${qtyPart}`;
}

export function fingerprintForDbRow(r) {
  const meta = safeJsonParse(r.meta, {});
  const blob = `${r.title || ''}\n${r.notes || ''}\n${meta.subtype || ''}\n${meta.quantity_label || ''}`;
  const on = normalizeOccurredOn(r.occurred_on) || sniffEuropeanDateFromBlob(blob) || '';
  const title = normalizeTitleKey(r.title);
  const amtRaw = r.amount != null ? r.amount : meta.line_total;
  const amt = amountFingerprintPart(amtRaw);
  const serial = extractSerialBlob(blob) || extractSerialBlob(r.title);
  let qtyPart = '';
  if (r.record_type === 'sale' && meta.quantity != null && Number.isFinite(Number(meta.quantity))) {
    qtyPart = `s${Math.abs(Number(meta.quantity))}`;
  } else if (meta.quantity != null && Number.isFinite(Number(meta.quantity))) {
    qtyPart = `p${Math.abs(Number(meta.quantity))}`;
  }
  return `${on}|${title}|${amt}|${serial}|${qtyPart}`;
}

/**
 * Skip lines that match an existing row fingerprint (re-pasted list / "double check").
 * @returns {{ toInsert: object[], skippedCount: number, totalIncoming: number }}
 */
export function partitionBulkItemsAgainstExisting(userId, items, defaultOccurredOn) {
  const list = Array.isArray(items) ? items : [];
  const recent = listUserRecords(userId, { limit: 500, record_type: null });
  const fpSet = new Set();
  for (const r of recent) {
    if (r.record_type === 'medicine') continue;
    fpSet.add(fingerprintForDbRow(r));
  }
  const toInsert = [];
  let skippedCount = 0;
  const seenBatch = new Set();
  for (const it of list) {
    const fp = fingerprintForBulkLine(it, defaultOccurredOn);
    if (fpSet.has(fp) || seenBatch.has(fp)) {
      skippedCount += 1;
      continue;
    }
    seenBatch.add(fp);
    toInsert.push(it);
  }
  return { toInsert, skippedCount, totalIncoming: list.length };
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
  const parts = [`#${r.id}`, r.record_type === 'sale' ? 'sale (stock out)' : r.record_type];
  if (r.occurred_on) parts.push(String(r.occurred_on));
  parts.push(`"${r.title}"`);
  if (meta.quantity != null && Number.isFinite(Number(meta.quantity))) {
    const u = meta.quantity_unit ? String(meta.quantity_unit) : meta.quantity_label ? String(meta.quantity_label) : '';
    parts.push(`qty ${meta.quantity}${u ? ' ' + u : ''}`);
  }
  if (r.amount != null && Number.isFinite(Number(r.amount))) {
    parts.push(`${r.amount}${r.currency ? ' ' + String(r.currency) : ''}`);
  }
  if (meta.unit_price != null && Number.isFinite(Number(meta.unit_price))) {
    parts.push(`unit ${meta.unit_price}`);
  }
  if (meta.schedule) parts.push(`schedule: ${String(meta.schedule)}`);
  if (r.notes) parts.push(`notes: ${String(r.notes).slice(0, 120)}${String(r.notes).length > 120 ? '…' : ''}`);
  return parts.join(' · ');
}

/**
 * Insert many purchase lines in one transaction (e.g. pasted inventory table).
 * @param {number} userId
 * @param {{ occurred_on?: string|null, currency?: string|null, items: Array<object> }} payload
 * @returns {{ count: number, firstId: number|null, lastId: number|null }}
 */
export function bulkAddPurchaseLines(userId, payload) {
  ensureSoul(userId);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length < 1) return { count: 0, firstId: null, lastId: null };
  const occurred_on = normalizeOccurredOn(payload.occurred_on) || null;
  const defaultCurrency =
    payload.currency != null ? String(payload.currency).trim().slice(0, 12) || null : null;
  const max = 100;
  const slice = items.slice(0, max);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO user_records (user_id, record_type, occurred_on, title, amount, currency, notes, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const work = () => {
    let firstId = null;
    let lastId = null;
    let inserted = 0;
    for (const raw of slice) {
      const it = raw && typeof raw === 'object' ? raw : {};
      const title = String(it.title || '').trim().slice(0, 500);
      if (!title) continue;
      let movement = String(it.movement || it.record_type || 'purchase').toLowerCase();
      if (movement === 'sold' || movement === 'use' || movement === 'usage') movement = 'sale';
      const recordType = movement === 'sale' ? 'sale' : 'purchase';
      let amount = it.line_total != null ? Number(it.line_total) : it.amount != null ? Number(it.amount) : null;
      if (!Number.isFinite(amount)) amount = null;
      const rowCurrency =
        it.currency != null
          ? String(it.currency).trim().slice(0, 12) || defaultCurrency
          : defaultCurrency;
      const notes = String(it.notes ?? '').trim().slice(0, 2000);
      let qty = it.quantity != null ? Number(it.quantity) : null;
      if (!Number.isFinite(qty)) qty = null;
      const rowOccurred = normalizeOccurredOn(it.occurred_on) || occurred_on;
      const meta = {
        line_no: it.line_no != null ? Number(it.line_no) : undefined,
        quantity_unit: it.quantity_unit != null ? String(it.quantity_unit).slice(0, 40) : undefined,
        quantity_label: it.quantity_label != null ? String(it.quantity_label).slice(0, 80) : undefined,
        unit_price: it.unit_price != null ? Number(it.unit_price) : undefined,
        line_total: it.line_total != null ? Number(it.line_total) : undefined,
        subtype: it.subtype != null ? String(it.subtype).slice(0, 120) : undefined,
        bulk_import: true,
      };
      if (recordType === 'sale' && qty != null) {
        meta.quantity = -Math.abs(qty);
        meta.movement = 'sale';
      } else if (qty != null) {
        meta.quantity = Math.abs(qty);
      }
      for (const k of Object.keys(meta)) {
        if (meta[k] === undefined || meta[k] === null || meta[k] === '' || Number.isNaN(meta[k])) {
          delete meta[k];
        }
      }
      const info = insert.run(
        userId,
        recordType,
        rowOccurred,
        title,
        amount,
        rowCurrency,
        notes,
        JSON.stringify(meta)
      );
      const id = Number(info.lastInsertRowid);
      if (Number.isFinite(id) && id > 0) {
        inserted += 1;
        if (firstId == null) firstId = id;
        lastId = id;
      }
    }
    return { firstId, lastId, inserted };
  };
  const { firstId, lastId, inserted } = db.transaction(work)();
  return { count: inserted, firstId, lastId };
}

/**
 * Net qty per product (purchase + sale rows with meta.quantity only). Titles matched case-insensitively.
 */
export function formatInventoryNetByTitle(userId, limitRows = 500) {
  const rows = listUserRecords(userId, { limit: limitRows, record_type: null });
  const sums = new Map();
  for (const r of rows) {
    if (r.record_type !== 'purchase' && r.record_type !== 'sale') continue;
    const meta = safeJsonParse(r.meta, {});
    if (!Number.isFinite(meta.quantity)) continue;
    const key = String(r.title || '').trim().toLowerCase();
    if (!key) continue;
    const prev = sums.get(key) || { total: 0, label: String(r.title || '').trim() };
    prev.total += meta.quantity;
    sums.set(key, prev);
  }
  if (!sums.size) return '';
  const lines = [...sums.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => `- "${v.label}": ${v.total} net units`);
  return lines.join('\n');
}

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
