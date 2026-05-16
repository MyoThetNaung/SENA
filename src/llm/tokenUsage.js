import { query } from '../db.js';

/** Local calendar day YYYY-MM-DD (for bucketing metrics). */
export function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
 */
export async function recordLlmUsage(p) {
  try {
    const now = new Date();
    const dayKey = localDayKey(now);
    const createdAt = now.toISOString();
    const promptTokens = Math.max(0, Math.floor(Number(p.promptTokens) || 0));
    const completionTokens = Math.max(0, Math.floor(Number(p.completionTokens) || 0));
    const durationMs = Math.max(0, Math.floor(Number(p.durationMs) || 0));
    await query(
      `INSERT INTO llm_usage (created_at, day_key, provider, model, prompt_tokens, completion_tokens, duration_ms)
       VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7)`,
      [createdAt, dayKey, String(p.provider || ''), String(p.model || ''), promptTokens, completionTokens, durationMs]
    );
  } catch {
    /* never break chat if metrics fail */
  }
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
