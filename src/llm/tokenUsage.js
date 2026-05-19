import { query } from '../db.js';

/** Local calendar day YYYY-MM-DD (for bucketing metrics). */
export function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar month YYYY-MM (for per-user monthly usage). */
export function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function tokensPerSec(row) {
  const total = (row.prompt_tokens || 0) + (row.completion_tokens || 0);
  const ms = row.duration_ms || 0;
  if (ms < 1 || total < 1) return null;
  return total / (ms / 1000);
}

/**
 * @param {object} p
 * @param {string} p.provider
 * @param {string} p.model
 * @param {number} p.promptTokens
 * @param {number} p.completionTokens
 * @param {number} p.durationMs
 * @param {number|null} [p.soulUserId]
 */
export async function recordLlmUsage(p) {
  try {
    const now = new Date();
    const dayKey = localDayKey(now);
    const mKey = monthKey(now);
    const createdAt = now.toISOString();
    const promptTokens = Math.max(0, Math.floor(Number(p.promptTokens) || 0));
    const completionTokens = Math.max(0, Math.floor(Number(p.completionTokens) || 0));
    const durationMs = Math.max(0, Math.floor(Number(p.durationMs) || 0));
    const soulUserId =
      p.soulUserId != null && Number.isFinite(Number(p.soulUserId)) ? Number(p.soulUserId) : null;
    await query(
      `INSERT INTO llm_usage (
         created_at, day_key, month_key, soul_user_id, provider, model,
         prompt_tokens, completion_tokens, duration_ms
       ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        createdAt,
        dayKey,
        mKey,
        soulUserId,
        String(p.provider || ''),
        String(p.model || ''),
        promptTokens,
        completionTokens,
        durationMs,
      ]
    );
  } catch {
    /* never break chat if metrics fail */
  }
}

/**
 * Monthly token totals for one soul user.
 * @param {number} soulUserId
 * @param {string} [month] YYYY-MM, defaults to current month
 */
export async function getUserMonthlyTokenUsage(soulUserId, month = monthKey()) {
  const uid = Number(soulUserId);
  const mk = String(month || monthKey()).trim();
  const r = await query(
    `SELECT
       COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_sum,
       COALESCE(SUM(completion_tokens), 0)::bigint AS completion_sum,
       COUNT(*)::int AS request_count
     FROM llm_usage
     WHERE soul_user_id = $1 AND month_key = $2`,
    [uid, mk]
  );
  const row = r.rows[0] || {};
  const prompt = Number(row.prompt_sum || 0);
  const completion = Number(row.completion_sum || 0);
  return {
    month: mk,
    soulUserId: uid,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    requestCount: row.request_count || 0,
  };
}

/**
 * Monthly token totals for all users with usage in that month (plus allowlist labels).
 * @param {string} [month] YYYY-MM
 */
export async function getAllUsersMonthlyTokenUsage(month = monthKey()) {
  const mk = String(month || monthKey()).trim();
  const r = await query(
    `SELECT
       u.soul_user_id,
       COALESCE(SUM(u.prompt_tokens), 0)::bigint AS prompt_sum,
       COALESCE(SUM(u.completion_tokens), 0)::bigint AS completion_sum,
       COUNT(*)::int AS request_count
     FROM llm_usage u
     WHERE u.soul_user_id IS NOT NULL AND u.month_key = $1
     GROUP BY u.soul_user_id
     ORDER BY (COALESCE(SUM(u.prompt_tokens), 0) + COALESCE(SUM(u.completion_tokens), 0)) DESC`,
    [mk]
  );

  const users = [];
  for (const row of r.rows) {
    const soulUserId = Number(row.soul_user_id);
    const prompt = Number(row.prompt_sum || 0);
    const completion = Number(row.completion_sum || 0);
    const allowR = await query(
      `SELECT email, username, soul_user_id FROM telegram_allowlist WHERE soul_user_id = $1 LIMIT 1`,
      [soulUserId]
    );
    const allow = allowR.rows[0];
    const soulR = await query(`SELECT display_name FROM soul WHERE user_id = $1`, [soulUserId]);
    const displayName = String(soulR.rows[0]?.display_name || '').trim();
    users.push({
      soulUserId,
      displayName: displayName || null,
      email: allow?.email || null,
      username: allow?.username || null,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
      requestCount: row.request_count || 0,
    });
  }
  return { month: mk, users };
}

/** Last N days (oldest first), local calendar. */
function dayKeysLastNDays(n) {
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(localDayKey(d));
  }
  return keys;
}

export async function getLlmUsageStats(provider = null) {
  const providerSql = provider ? ' WHERE provider = $1' : '';
  const providerArgs = provider ? [String(provider)] : [];
  const totalR = await query(
    `SELECT 
      COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_sum,
      COALESCE(SUM(completion_tokens), 0)::bigint AS completion_sum,
      COUNT(*)::int AS n
     FROM llm_usage${providerSql}`,
    providerArgs
  );
  const totalRow = totalR.rows[0];
  const totalTokens = Number(totalRow.prompt_sum || 0) + Number(totalRow.completion_sum || 0);
  const todayKey = localDayKey();
  const todayArgs = provider ? [todayKey, String(provider)] : [todayKey];
  const todaySql = provider
    ? `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS t
       FROM llm_usage WHERE day_key = $1 AND provider = $2`
    : `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS t
       FROM llm_usage WHERE day_key = $1`;
  const todayR = await query(todaySql, todayArgs);
  const todayTokens = Number(todayR.rows[0]?.t ?? 0);

  const lastR = await query(`SELECT * FROM llm_usage${providerSql} ORDER BY id DESC LIMIT 1`, providerArgs);
  const last = lastR.rows[0];
  const lastTokensPerSec = last ? tokensPerSec(last) : null;

  const recentR = await query(
    `SELECT prompt_tokens, completion_tokens, duration_ms FROM llm_usage
     WHERE duration_ms >= 50 AND (prompt_tokens + completion_tokens) > 0${
       provider ? ' AND provider = $1' : ''
     }
     ORDER BY id DESC LIMIT 80`,
    providerArgs
  );
  const tpsVals = recentR.rows.map((row) => tokensPerSec(row)).filter((v) => v != null);
  const avgTokensPerSec = tpsVals.length ? tpsVals.reduce((a, b) => a + b, 0) / tpsVals.length : null;

  const keys14 = dayKeysLastNDays(14);
  const daily = [];
  for (const day of keys14) {
    const dayArgs = provider ? [day, String(provider)] : [day];
    const daySql = provider
      ? `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS t
         FROM llm_usage WHERE day_key = $1 AND provider = $2`
      : `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS t
         FROM llm_usage WHERE day_key = $1`;
    const dr = await query(daySql, dayArgs);
    const tokens = Number(dr.rows[0]?.t ?? 0);
    const short = day.slice(5);
    daily.push({ day, label: short, tokens });
  }

  return {
    totalTokens,
    todayTokens,
    promptTotal: Number(totalRow.prompt_sum || 0),
    completionTotal: Number(totalRow.completion_sum || 0),
    requestCount: totalRow.n || 0,
    lastTokensPerSec,
    lastDurationMs: last?.duration_ms ?? null,
    lastCompletionTokens: last?.completion_tokens ?? null,
    lastProvider: last?.provider || '',
    lastModel: last?.model || '',
    avgTokensPerSec,
    daily,
  };
}
