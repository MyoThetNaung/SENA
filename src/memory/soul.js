import { query } from '../db.js';
import { SCOPED_USER_ID_OFFSET } from '../access/telegramAccess.js';
import { getCalendarClockContext } from '../calendar/resolveStartsAt.js';
import { normalizeTimezone } from '../util/timezone.js';

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export async function getSoul(userId) {
  const r = await query('SELECT * FROM soul WHERE user_id = $1', [userId]);
  const row = r.rows[0];
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

export async function listSouls(filter = {}) {
  const botId = filter?.botId != null && filter.botId !== '' ? Number(filter.botId) : null;
  let rows;
  if (Number.isFinite(botId)) {
    const r = await query(
      `SELECT s.user_id, s.display_name, s.preferences, s.facts, s.updated_at
       FROM soul s
       JOIN telegram_identity_map m ON m.id = (s.user_id - $1)
       WHERE m.bot_id = $2
       ORDER BY s.user_id`,
      [SCOPED_USER_ID_OFFSET, botId]
    );
    rows = r.rows;
  } else {
    const r = await query(`SELECT user_id, display_name, preferences, facts, updated_at FROM soul ORDER BY user_id`);
    rows = r.rows;
  }
  return rows.map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    preferences: safeJsonParse(row.preferences, {}),
    facts: safeJsonParse(row.facts, []),
    updated_at: row.updated_at,
  }));
}

export async function ensureSoul(userId) {
  await query(
    `INSERT INTO soul (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export async function updateSoul(userId, patch) {
  await ensureSoul(userId);
  const current = await getSoul(userId);
  const display_name = patch.display_name !== undefined ? patch.display_name : current.display_name;
  const preferences =
    patch.preferences !== undefined ? { ...current.preferences, ...patch.preferences } : current.preferences;
  const facts = patch.facts !== undefined ? patch.facts : current.facts;
  await query(
    `UPDATE soul SET display_name = $1, preferences = $2, facts = $3, updated_at = timezone('utc', now()) WHERE user_id = $4`,
    [display_name, JSON.stringify(preferences), JSON.stringify(facts), userId]
  );
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
  if (prof.timezone) parts.push(`Timezone (for dates/times): ${prof.timezone}`);
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
export async function mergeProfileMemorySummary(userId, summaryText) {
  await ensureSoul(userId);
  const current = await getSoul(userId);
  const prof = {
    ...(current.preferences?.profile && typeof current.preferences.profile === 'object'
      ? current.preferences.profile
      : {}),
    memorySummary: String(summaryText || '').trim().slice(0, 4000),
  };
  const preferences = { ...current.preferences, profile: prof };
  await query(`UPDATE soul SET preferences = $1, updated_at = timezone('utc', now()) WHERE user_id = $2`, [
    JSON.stringify(preferences),
    userId,
  ]);
}

/** Replace display name, profile, and/or per-session assistant (bot) persona. Legacy facts column cleared on save. */
export async function setSoulContent(userId, { display_name, profile, botPersona }) {
  await ensureSoul(userId);
  const current = await getSoul(userId);
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
          timezone:
            profile.timezone !== undefined
              ? normalizeTimezone(profile.timezone) || ''
              : normalizeTimezone(prevProf.timezone) || '',
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
  await query(
    `UPDATE soul SET display_name = $1, preferences = $2, facts = $3, updated_at = timezone('utc', now()) WHERE user_id = $4`,
    [name, JSON.stringify(preferences), JSON.stringify([]), userId]
  );
}

export async function clearSoul(userId) {
  await query('DELETE FROM soul WHERE user_id = $1', [userId]);
}

export async function copySoulFromTo(fromUserId, toUserId) {
  const src = await getSoul(fromUserId);
  await ensureSoul(toUserId);
  await query(
    `UPDATE soul SET display_name = $1, preferences = $2, facts = $3, updated_at = timezone('utc', now()) WHERE user_id = $4`,
    [src.display_name, JSON.stringify(src.preferences), JSON.stringify(src.facts), toUserId]
  );
}

/** Copy only `preferences.botPersona` from one soul to another (rest of destination soul unchanged). */
/** Calendar context for a user (profile.timezone or server default). */
export async function getClockContextForUser(userId) {
  const soul = await getSoul(userId);
  const tz = soul.preferences?.profile?.timezone;
  return getCalendarClockContext({ timezone: tz });
}

export function getTimezoneFromSoul(soul) {
  return normalizeTimezone(soul?.preferences?.profile?.timezone) || '';
}

export async function copyBotPersonaFromTo(fromUserId, toUserId) {
  await ensureSoul(fromUserId);
  await ensureSoul(toUserId);
  const src = await getSoul(fromUserId);
  const dest = await getSoul(toUserId);
  const raw = src.preferences?.botPersona;
  const preferences = { ...dest.preferences };
  const norm = normalizeSoulBotPersona(raw);
  const any = Object.values(norm).some((v) => v !== '');
  if (any) preferences.botPersona = norm;
  else delete preferences.botPersona;
  await query(`UPDATE soul SET preferences = $1, updated_at = timezone('utc', now()) WHERE user_id = $2`, [
    JSON.stringify(preferences),
    toUserId,
  ]);
}
