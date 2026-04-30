import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { SCOPED_USER_ID_OFFSET } from '../access/telegramAccess.js';

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function getSoul(userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM soul WHERE user_id = ?').get(userId);
  if (!row) {
    return {
      user_id: userId,
      display_name: null,
      preferences: {},
      facts: [],
    };
  }
  return {
    user_id: row.user_id,
    display_name: row.display_name,
    preferences: safeJsonParse(row.preferences, {}),
    facts: safeJsonParse(row.facts, []),
  };
}

export function listSouls(filter = {}) {
  const botId = filter?.botId != null && filter.botId !== '' ? Number(filter.botId) : null;
  const db = getDb();
  let rows = [];
  if (Number.isFinite(botId)) {
    rows = db
      .prepare(
        `SELECT s.user_id, s.display_name, s.preferences, s.facts, s.updated_at
         FROM soul s
         JOIN telegram_identity_map m ON m.id = (s.user_id - ?)
         WHERE m.bot_id = ?
         ORDER BY s.user_id`
      )
      .all(SCOPED_USER_ID_OFFSET, botId);
  } else {
    rows = db
      .prepare(`SELECT user_id, display_name, preferences, facts, updated_at FROM soul ORDER BY user_id`)
      .all();
  }
  return rows.map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    preferences: safeJsonParse(row.preferences, {}),
    facts: safeJsonParse(row.facts, []),
    updated_at: row.updated_at,
  }));
}

export function ensureSoul(userId) {
  const db = getDb();
  db.prepare(
    `INSERT INTO soul (user_id) VALUES (?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId);
}

export function updateSoul(userId, patch) {
  ensureSoul(userId);
  const db = getDb();
  const current = getSoul(userId);
  const display_name = patch.display_name !== undefined ? patch.display_name : current.display_name;
  const preferences =
    patch.preferences !== undefined ? { ...current.preferences, ...patch.preferences } : current.preferences;
  const facts = patch.facts !== undefined ? patch.facts : current.facts;
  db.prepare(
    `UPDATE soul SET display_name = ?, preferences = ?, facts = ?, updated_at = datetime('now') WHERE user_id = ?`
  ).run(display_name, JSON.stringify(preferences), JSON.stringify(facts), userId);
}

export function normalizeSoulBotPersona(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    displayName: String(o.displayName ?? '').trim(),
    displayNameMy: String(o.displayNameMy ?? '').trim(),
    gender: String(o.gender ?? '').trim(),
    style: String(o.style ?? '').trim(),
    role: String(o.role ?? '').trim(),
    addressUserEn: String(o.addressUserEn ?? '').trim(),
    addressUserMy: String(o.addressUserMy ?? '').trim(),
  };
}

export function formatSoulForPrompt(soul) {
  const parts = [];
  if (soul.display_name) parts.push(`Name (preferred): ${soul.display_name}`);
  const prefs = soul.preferences || {};
  const prof = prefs.profile && typeof prefs.profile === 'object' ? prefs.profile : {};
  if (prof.whoAmI) parts.push(`Who they are: ${prof.whoAmI}`);
  if (prof.work) parts.push(`Work / occupation: ${prof.work}`);
  if (prof.gender) parts.push(`Gender: ${prof.gender}`);
  if (prof.age) parts.push(`Age: ${prof.age}`);
  if (prof.extra) parts.push(`Other notes: ${prof.extra}`);
  if (prof.memorySummary) {
    parts.push(`Conversation memory (summary of what you discussed):\n${prof.memorySummary}`);
  }
  const restPrefs = { ...prefs };
  delete restPrefs.profile;
  delete restPrefs.botPersona;
  if (Object.keys(restPrefs).length) {
    parts.push(`Other preferences: ${JSON.stringify(restPrefs)}`);
  }
  return parts.length ? parts.join('\n') : 'No stored memory yet.';
}

/** LLM summary refresh — does not touch GUI-only fields except memorySummary */
export function mergeProfileMemorySummary(userId, summaryText) {
  ensureSoul(userId);
  const current = getSoul(userId);
  const prof = {
    ...(current.preferences?.profile && typeof current.preferences.profile === 'object'
      ? current.preferences.profile
      : {}),
    memorySummary: String(summaryText || '').trim().slice(0, 4000),
  };
  const preferences = { ...current.preferences, profile: prof };
  const db = getDb();
  db.prepare(`UPDATE soul SET preferences = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
    JSON.stringify(preferences),
    userId
  );
}

/** Replace display name, profile, and/or per-session assistant (bot) persona. Legacy facts column cleared on save. */
export function setSoulContent(userId, { display_name, profile, botPersona }) {
  ensureSoul(userId);
  const db = getDb();
  const current = getSoul(userId);
  const prevProf =
    current.preferences?.profile && typeof current.preferences.profile === 'object'
      ? current.preferences.profile
      : {};
  const nextProfile =
    profile && typeof profile === 'object'
      ? {
          whoAmI: String(profile.whoAmI ?? '').trim(),
          work: String(profile.work ?? '').trim(),
          gender: String(profile.gender ?? '').trim(),
          age: String(profile.age ?? '').trim(),
          extra: String(profile.extra ?? '').trim(),
          memorySummary: String(profile.memorySummary ?? prevProf.memorySummary ?? '').trim(),
          addressUserEn: String(profile.addressUserEn ?? prevProf.addressUserEn ?? '').trim(),
          addressUserMy: String(profile.addressUserMy ?? prevProf.addressUserMy ?? '').trim(),
        }
      : { ...prevProf };
  const preferences = { ...current.preferences, profile: nextProfile };
  if (botPersona !== undefined) {
    const norm = normalizeSoulBotPersona(botPersona);
    const any = Object.values(norm).some((v) => v !== '');
    if (any) preferences.botPersona = norm;
    else delete preferences.botPersona;
  }
  const name = display_name !== undefined ? String(display_name || '').trim() || null : current.display_name;
  db.prepare(
    `UPDATE soul SET display_name = ?, preferences = ?, facts = ?, updated_at = datetime('now') WHERE user_id = ?`
  ).run(name, JSON.stringify(preferences), JSON.stringify([]), userId);
}

export function clearSoul(userId) {
  const db = getDb();
  db.prepare('DELETE FROM soul WHERE user_id = ?').run(userId);
}

export function copySoulFromTo(fromUserId, toUserId) {
  const src = getSoul(fromUserId);
  ensureSoul(toUserId);
  const db = getDb();
  db.prepare(
    `UPDATE soul SET display_name = ?, preferences = ?, facts = ?, updated_at = datetime('now') WHERE user_id = ?`
  ).run(src.display_name, JSON.stringify(src.preferences), JSON.stringify(src.facts), toUserId);
}

/** Copy only `preferences.botPersona` from one soul to another (rest of destination soul unchanged). */
export function copyBotPersonaFromTo(fromUserId, toUserId) {
  ensureSoul(fromUserId);
  ensureSoul(toUserId);
  const src = getSoul(fromUserId);
  const dest = getSoul(toUserId);
  const raw = src.preferences?.botPersona;
  const preferences = { ...dest.preferences };
  const norm = normalizeSoulBotPersona(raw);
  const any = Object.values(norm).some((v) => v !== '');
  if (any) preferences.botPersona = norm;
  else delete preferences.botPersona;
  const db = getDb();
  db.prepare(
    `UPDATE soul SET preferences = ?, updated_at = datetime('now') WHERE user_id = ?`
  ).run(JSON.stringify(preferences), toUserId);
}
