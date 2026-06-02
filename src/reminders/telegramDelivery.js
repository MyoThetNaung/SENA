import { query } from "../db.js";
import { SCOPED_USER_ID_OFFSET, getBotIdForScopedUserId } from "../access/telegramAccess.js";
import { listAllUserBotTokens } from "../access/userTelegramBots.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

/** @type {{ token: string, bot: import('node-telegram-bot-api'), botId: number|null }[]} */
let runningBots = [];

export function registerRunningBots(entries) {
  runningBots = (entries || []).map((e) => ({
    token: e.token,
    bot: e.bot,
    botId: e.botId != null ? Number(e.botId) : null,
  }));
}

/**
 * @returns {Promise<{ chatId: number, botId: number|null }|null>}
 */
export async function resolveTelegramChatForSoulUser(soulUserId) {
  const uid = Number(soulUserId);
  if (!Number.isFinite(uid)) return null;

  const scopedBotId = await getBotIdForScopedUserId(uid);
  if (scopedBotId != null) {
    const r = await query(
      "SELECT telegram_user_id FROM telegram_identity_map WHERE id = $1",
      [uid - SCOPED_USER_ID_OFFSET],
    );
    const tid = Number(r.rows[0]?.telegram_user_id);
    if (Number.isFinite(tid)) return { chatId: tid, botId: scopedBotId };
    return null;
  }

  const allow = await query(
    `SELECT telegram_user_id FROM telegram_allowlist
     WHERE soul_user_id = $1 AND status <> 'disabled' AND telegram_user_id IS NOT NULL
     LIMIT 1`,
    [uid],
  );
  const allowTid = Number(allow.rows[0]?.telegram_user_id);
  if (Number.isFinite(allowTid)) return { chatId: allowTid, botId: null };

  const tu = await query(
    `SELECT user_id FROM telegram_users WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
    [uid],
  );
  if (tu.rows[0]) return { chatId: uid, botId: null };

  return null;
}

async function pickBotInstance(preferredBotId) {
  if (!runningBots.length) return null;
  const bid = preferredBotId != null ? Number(preferredBotId) : null;
  if (Number.isFinite(bid)) {
    const match = runningBots.find((b) => b.botId === bid);
    if (match) return match;
    const rows = await listAllUserBotTokens();
    const row = rows.find((r) => Number(r.botId) === bid);
    if (row?.token) {
      const byToken = runningBots.find((b) => b.token === row.token);
      if (byToken) return byToken;
    }
  }
  return runningBots[0] || null;
}

/**
 * @param {{ soulUserId: number, text: string, botId?: number|null }} opts
 */
export async function sendProactiveTelegramMessage(opts) {
  const cfg = getConfig();
  if (!cfg.remindersEnabled) return { ok: false, error: "Reminders disabled" };

  const target = await resolveTelegramChatForSoulUser(opts.soulUserId);
  if (!target) return { ok: false, error: "No Telegram chat for user" };

  const botEntry = await pickBotInstance(opts.botId ?? target.botId);
  if (!botEntry?.bot) return { ok: false, error: "No Telegram bot running" };

  const text = String(opts.text || "").trim();
  if (!text) return { ok: false, error: "Empty message" };

  try {
    await botEntry.bot.sendMessage(target.chatId, text.slice(0, 4000));
    return { ok: true };
  } catch (e) {
    logger.warn(`sendProactiveTelegramMessage: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
