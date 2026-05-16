import TelegramBot from 'node-telegram-bot-api';
import { getConfig, reloadConfig } from '../config.js';
import { listKnownTelegramBots } from './telegramAccess.js';

/**
 * All bots configured in settings (by token), with Telegram ids from getMe.
 * Merges live user counts from telegram_identity_map when available.
 */
export async function listConfiguredTelegramBots() {
  reloadConfig();
  const tokens = Array.isArray(getConfig().telegramBotTokens) ? getConfig().telegramBotTokens : [];
  let knownByTelegramId = new Map();
  try {
    const known = await listKnownTelegramBots();
    knownByTelegramId = new Map(known.map((b) => [b.botId, b]));
  } catch {
    /* identity table may be empty */
  }

  const bots = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = String(tokens[tokenIndex] || '').trim();
    if (!token) continue;
    let botId = null;
    let username = '';
    let ok = true;
    let error = null;
    try {
      const probe = new TelegramBot(token, { polling: false });
      const me = await probe.getMe();
      botId = Number(me?.id);
      username = String(me?.username || '').trim();
      if (!Number.isFinite(botId)) {
        ok = false;
        error = 'Could not read bot id';
      }
    } catch (e) {
      ok = false;
      error = String(e?.message || 'getMe failed');
    }

    const stats = Number.isFinite(botId) ? knownByTelegramId.get(botId) : null;
    bots.push({
      index: tokenIndex,
      tokenIndex,
      botId: Number.isFinite(botId) ? botId : null,
      username,
      ok,
      error,
      users: stats?.users ?? 0,
      lastSeen: stats?.lastSeen ?? null,
    });
  }
  return bots;
}

/**
 * Resolve Telegram bot id for a token string (null if invalid).
 * @param {string} token
 */
export async function resolveTelegramBotIdFromToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    const me = await new TelegramBot(t, { polling: false }).getMe();
    const id = Number(me?.id);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Drop per-bot settings keys for a removed token (telegram id + legacy 1-based slot keys).
 * @param {Record<string, unknown>} rawMap
 * @param {number} removedTokenIndex
 * @param {number|null} telegramBotId
 */
export function removeBotScopedMapKeys(rawMap, removedTokenIndex, telegramBotId) {
  const src = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
  const out = { ...src };
  const legacySlot = String(removedTokenIndex + 1);
  delete out[legacySlot];
  if (telegramBotId != null && Number.isFinite(telegramBotId)) {
    delete out[String(telegramBotId)];
  }
  return out;
}
