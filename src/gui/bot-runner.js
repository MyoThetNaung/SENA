import { createBot } from '../bot/telegram.js';
import { assertBotConfigReady, getConfig, reloadConfig } from '../config.js';
import { getPool } from '../db.js';
import { ensureLlmBackendReachable } from '../llm/llamaProcess.js';
import { logger } from '../logger.js';
import { listAllUserBotTokens } from '../access/userTelegramBots.js';

/** @type {{ token: string, bot: import('node-telegram-bot-api') }[]} */
let botInstances = [];
let starting = false;
/** @type {string[]} */
let cachedUserBotTokens = [];
/** @type {{ token: string, ownerSoulUserId: number }[]} */
let cachedUserBotRows = [];

export async function refreshUserBotTokensCache() {
  try {
    await getPool();
    const rows = await listAllUserBotTokens();
    cachedUserBotRows = rows
      .map((r) => ({
        token: String(r.token || '').trim(),
        ownerSoulUserId: Number(r.ownerSoulUserId),
      }))
      .filter((r) => r.token && Number.isFinite(r.ownerSoulUserId));
    cachedUserBotTokens = cachedUserBotRows.map((r) => r.token);
  } catch (e) {
    logger.warn(`refreshUserBotTokensCache: ${e.message}`);
    cachedUserBotTokens = [];
    cachedUserBotRows = [];
  }
  return cachedUserBotTokens;
}

function configuredTokens() {
  reloadConfig();
  const global = Array.isArray(getConfig().telegramBotTokens) ? getConfig().telegramBotTokens : [];
  const merged = [...global, ...cachedUserBotTokens];
  return [...new Set(merged.map((t) => String(t || '').trim()).filter(Boolean))];
}

function tokensInSync(tokens, running) {
  if (tokens.length !== running.length) return false;
  const live = new Set(running.map((e) => e.token));
  return tokens.every((t) => live.has(t));
}

export function getBotStatus() {
  const tokens = configuredTokens(); // includes cached user tokens when refreshed via sync/start
  const runningBotCount = botInstances.length;
  return {
    running: runningBotCount > 0,
    starting,
    botCount: runningBotCount,
    configuredBotCount: tokens.length,
    needsRestart: runningBotCount > 0 && !tokensInSync(tokens, botInstances),
  };
}

/** Bot status for one portal user (only their Telegram tokens). */
export function getBotStatusForOwner(ownerSoulUserId) {
  const owner = Number(ownerSoulUserId);
  if (!Number.isFinite(owner)) {
    return { running: false, botCount: 0, configuredBotCount: 0 };
  }
  const userTokens = cachedUserBotRows
    .filter((r) => r.ownerSoulUserId === owner)
    .map((r) => r.token);
  const live = new Set(botInstances.map((e) => e.token));
  const botCount = userTokens.filter((t) => live.has(t)).length;
  return {
    running: botCount > 0,
    botCount,
    configuredBotCount: userTokens.length,
  };
}

/**
 * Start bots for newly saved tokens and stop bots whose tokens were removed.
 */
export async function syncBotsWithConfig() {
  await refreshUserBotTokensCache();
  reloadConfig();
  const tokens = configuredTokens();

  const configuredSet = new Set(tokens);
  const next = [];
  let stopped = 0;
  for (const entry of botInstances) {
    if (configuredSet.has(entry.token)) {
      next.push(entry);
      continue;
    }
    try {
      await entry.bot.stopPolling({ cancel: true });
    } catch {
      /* ignore */
    }
    stopped += 1;
    logger.info('Telegram bot stopped (token removed from settings)');
  }
  botInstances = next;

  const runningTokens = new Set(botInstances.map((e) => e.token));
  let started = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (runningTokens.has(token)) continue;
    const bot = await createBot(token, i);
    botInstances.push({ token, bot });
    started += 1;
    logger.info(`Telegram bot started for newly configured token (slot ${i + 1})`);
  }

  return {
    ok: true,
    botCount: botInstances.length,
    configuredBotCount: tokens.length,
    started,
    stopped,
  };
}

async function ensureLlmReadyForBots() {
  await getPool();
  return ensureLlmBackendReachable();
}

export async function startBotFromGui() {
  if (starting) {
    return { ok: false, error: 'Bot is already starting.' };
  }
  starting = true;
  try {
    await refreshUserBotTokensCache();
    reloadConfig();
    const tokens = configuredTokens();
    if (!tokens.length) {
      return { ok: false, error: 'No Telegram bot token configured.' };
    }

    const llm = await ensureLlmReadyForBots();
    if (!llm.ok) return llm;

    const before = botInstances.length;
    const out = await syncBotsWithConfig();
    if (out.botCount > 0 && before === out.botCount && out.started === 0 && out.stopped === 0) {
      return {
        ...out,
        alreadyRunning: true,
      };
    }
    return out;
  } catch (e) {
    logger.error(`GUI start bot: ${e.message}`);
    for (const entry of botInstances) {
      try {
        await entry.bot.stopPolling({ cancel: true });
      } catch {
        /* ignore */
      }
    }
    botInstances = [];
    return { ok: false, error: e.message || String(e) };
  } finally {
    starting = false;
  }
}

export async function stopBotFromGui() {
  if (!botInstances.length) {
    return { ok: false, error: 'Bot is not running.' };
  }
  try {
    const running = [...botInstances];
    for (const entry of running) {
      await entry.bot.stopPolling({ cancel: true });
    }
    botInstances = [];
    logger.info('Telegram polling stopped (GUI, all bots)');
    return { ok: true, botCount: 0 };
  } catch (e) {
    logger.error(`stopPolling: ${e.message}`);
    botInstances = [];
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Apply token list changes while bots are already running (add/remove without full stop).
 */
export async function applyTelegramTokenListChange() {
  if (starting) {
    return { ok: false, error: 'Bot is starting; try again in a moment.' };
  }
  if (!botInstances.length) {
    return { ok: true, skipped: true };
  }
  starting = true;
  try {
    const llm = await ensureLlmBackendReachable();
    if (!llm.ok) return llm;
    return await syncBotsWithConfig();
  } catch (e) {
    logger.error(`Token list sync: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  } finally {
    starting = false;
  }
}
