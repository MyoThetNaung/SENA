import TelegramBot from 'node-telegram-bot-api';
import { query } from '../db.js';
import { logger } from '../logger.js';

export function maskBotToken(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function isValidTelegramBotToken(raw) {
  const t = String(raw ?? '').trim();
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(t);
}

/**
 * @param {string} token
 * @returns {Promise<{ botId: number, username: string }>}
 */
export async function probeTelegramBotToken(token) {
  const t = String(token || '').trim();
  if (!isValidTelegramBotToken(t)) {
    throw new Error('Invalid Telegram bot token format.');
  }
  try {
    const me = await new TelegramBot(t, { polling: false }).getMe();
    const botId = Number(me?.id);
    if (!Number.isFinite(botId)) throw new Error('Could not read bot id from Telegram.');
    return { botId, username: String(me?.username || '').trim() };
  } catch (e) {
    throw new Error(e?.message || 'getMe failed — check the token from @BotFather.');
  }
}

export async function getOwnerSoulUserIdForBotId(botId) {
  const id = Number(botId);
  if (!Number.isFinite(id)) return null;
  const r = await query(
    `SELECT owner_soul_user_id FROM user_telegram_bots WHERE bot_id = $1 LIMIT 1`,
    [id]
  );
  const owner = r.rows[0]?.owner_soul_user_id;
  return Number.isFinite(Number(owner)) ? Number(owner) : null;
}

export async function listBotsForOwner(ownerSoulUserId) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) return [];
  const r = await query(
    `SELECT id, bot_id, bot_username, bot_token, created_at, updated_at
     FROM user_telegram_bots
     WHERE owner_soul_user_id = $1
     ORDER BY created_at`,
    [owner]
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    botId: Number(row.bot_id),
    botUsername: row.bot_username || null,
    tokenMasked: maskBotToken(row.bot_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** All user-owned bot tokens (for polling). */
export async function listAllUserBotTokens() {
  const r = await query(
    `SELECT bot_token, bot_id, owner_soul_user_id FROM user_telegram_bots ORDER BY id`
  );
  return r.rows.map((row) => ({
    token: String(row.bot_token),
    botId: Number(row.bot_id),
    ownerSoulUserId: Number(row.owner_soul_user_id),
  }));
}

/**
 * @param {number} ownerSoulUserId
 * @param {string} token
 */
export async function addBotForOwner(ownerSoulUserId, token) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) throw new Error('Invalid owner');

  const { botId, username } = await probeTelegramBotToken(token);

  const dupOwner = await query(
    `SELECT id FROM user_telegram_bots WHERE owner_soul_user_id = $1 AND bot_id = $2`,
    [owner, botId]
  );
  if (dupOwner.rows[0]) {
    throw new Error('This bot is already connected to your account.');
  }

  const dupBot = await query(`SELECT owner_soul_user_id FROM user_telegram_bots WHERE bot_id = $1`, [
    botId,
  ]);
  if (dupBot.rows[0]) {
    throw new Error('This bot is already registered by another account.');
  }

  const r = await query(
    `INSERT INTO user_telegram_bots (owner_soul_user_id, bot_token, bot_id, bot_username)
     VALUES ($1, $2, $3, $4)
     RETURNING id, bot_id, bot_username, created_at`,
    [owner, String(token).trim(), botId, username || null]
  );
  logger.info(`User bot added: owner=${owner} bot_id=${botId} @${username || '?'}`);
  return {
    id: Number(r.rows[0].id),
    botId,
    botUsername: username || null,
    tokenMasked: maskBotToken(token),
    createdAt: r.rows[0].created_at,
  };
}

export async function removeBotForOwner(ownerSoulUserId, botId) {
  const owner = Number(ownerSoulUserId);
  const bid = Number(botId);
  if (!Number.isFinite(owner) || !Number.isFinite(bid)) throw new Error('Invalid bot');

  const r = await query(
    `DELETE FROM user_telegram_bots WHERE owner_soul_user_id = $1 AND bot_id = $2 RETURNING id`,
    [owner, bid]
  );
  if (!r.rows[0]) throw new Error('Bot not found on your account.');

  await query(`DELETE FROM user_bot_access WHERE owner_soul_user_id = $1 AND bot_id = $2`, [
    owner,
    bid,
  ]);
  logger.info(`User bot removed: owner=${owner} bot_id=${bid}`);
  return { ok: true };
}
