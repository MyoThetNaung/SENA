import crypto from 'crypto';
import { getConfig } from '../config.js';

const DEFAULT_MAX_AUTH_AGE_SEC = 3600;

function maxAuthAgeSec() {
  const raw = Number(process.env.TELEGRAM_LOGIN_MAX_AGE_SEC);
  if (Number.isFinite(raw) && raw >= 60 && raw <= 86400) return Math.floor(raw);
  return DEFAULT_MAX_AUTH_AGE_SEC;
}

function safeEqualHex(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (expected.length !== actual.length) return false;
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(actual, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify Telegram Login Widget payload.
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLoginPayload(data, botToken) {
  const token = String(botToken || '').trim();
  if (!token) return { ok: false, error: 'Bot token not configured' };

  const hash = String(data?.hash ?? '');
  if (!hash) return { ok: false, error: 'Missing hash' };

  const authDate = Number(data?.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, error: 'Missing auth_date' };
  const maxAge = maxAuthAgeSec();
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAge) return { ok: false, error: 'Login expired, try again' };

  const pairs = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    if (v === undefined || v === null || v === '') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHash('sha256').update(token).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualHex(hmac, hash.toLowerCase())) {
    return { ok: false, error: 'Invalid Telegram login signature' };
  }

  const id = Number(data.id);
  if (!Number.isFinite(id)) return { ok: false, error: 'Missing user id' };

  return {
    ok: true,
    loginHash: hash.toLowerCase(),
    user: {
      id,
      first_name: data.first_name != null ? String(data.first_name) : '',
      last_name: data.last_name != null ? String(data.last_name) : '',
      username: data.username != null ? String(data.username) : '',
      photo_url: data.photo_url != null ? String(data.photo_url) : '',
      auth_date: authDate,
    },
  };
}

export function getTelegramLoginBotToken() {
  const c = getConfig();
  const tokens = Array.isArray(c.telegramBotTokens) ? c.telegramBotTokens : [];
  return tokens[0] || c.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
}
