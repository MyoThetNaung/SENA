import { getDb } from '../db.js';

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
export function recordLlmUsage(p) {
  try {
    const db = getDb();
    const now = new Date();
    const dayKey = localDayKey(now);
    const createdAt = now.toISOString();
    const promptTokens = Math.max(0, Math.floor(Number(p.promptTokens) || 0));
    const completionTokens = Math.max(0, Math.floor(Number(p.completionTokens) || 0));
    const durationMs = Math.max(0, Math.floor(Number(p.durationMs) || 0));
    db.prepare(
      `INSERT INTO llm_usage (created_at, day_key, provider, model, prompt_tokens, completion_tokens, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createdAt,
      dayKey,
      String(p.provider || ''),
      String(p.model || ''),
      promptTokens,
      completionTokens,
      durationMs
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

export function getLlmUsageStats(provider = null) {
  const db = getDb();
  const providerSql = provider ? ' WHERE provider = ?' : '';
  const providerArgs = provider ? [String(provider)] : [];
  const totalRow = db
    .prepare(
      `SELECT 
        COALESCE(SUM(prompt_tokens), 0) as prompt_sum,
        COALESCE(SUM(completion_tokens), 0) as completion_sum,
        COUNT(*) as n
       FROM llm_usage${providerSql}`
    )
    .get(...providerArgs);
  const totalTokens = (totalRow.prompt_sum || 0) + (totalRow.completion_sum || 0);
  const todayKey = localDayKey();
  const todayRow = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as t
       FROM llm_usage WHERE day_key = ?${provider ? ' AND provider = ?' : ''}`
    )
    .get(todayKey, ...providerArgs);
  const todayTokens = todayRow?.t ?? 0;

  const last = db
    .prepare(`SELECT * FROM llm_usage${providerSql} ORDER BY id DESC LIMIT 1`)
    .get(...providerArgs);
  const lastTokensPerSec = last ? tokensPerSec(last) : null;

  const recent = db
    .prepare(
      `SELECT prompt_tokens, completion_tokens, duration_ms FROM llm_usage
       WHERE duration_ms >= 50 AND (prompt_tokens + completion_tokens) > 0${
         provider ? ' AND provider = ?' : ''
       }
       ORDER BY id DESC LIMIT 80`
    )
    .all(...providerArgs);
  const tpsVals = recent.map((r) => tokensPerSec(r)).filter((v) => v != null);
  const avgTokensPerSec = tpsVals.length ? tpsVals.reduce((a, b) => a + b, 0) / tpsVals.length : null;

  const keys14 = dayKeysLastNDays(14);
  const daily = keys14.map((day) => {
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as t
         FROM llm_usage WHERE day_key = ?${provider ? ' AND provider = ?' : ''}`
      )
      .get(day, ...providerArgs);
    const tokens = r?.t ?? 0;
    const short = day.slice(5);
    return { day, label: short, tokens };
  });

  return {
    totalTokens,
    todayTokens,
    promptTotal: totalRow.prompt_sum || 0,
    completionTotal: totalRow.completion_sum || 0,
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
