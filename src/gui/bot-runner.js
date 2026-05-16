import { createBot } from '../bot/telegram.js';
import { assertBotConfigReady, getConfig, reloadConfig } from '../config.js';
import { getPool } from '../db.js';
import {
  startLlamaServerIfConfigured,
  stopLlamaServerIfWeStarted,
  ensureLlamaServerReachable,
} from '../llm/llamaProcess.js';
import { logger } from '../logger.js';

let botInstances = [];
let starting = false;

export function getBotStatus() {
  reloadConfig();
  const configuredBotCount = Array.isArray(getConfig().telegramBotTokens)
    ? getConfig().telegramBotTokens.length
    : 0;
  const runningBotCount = botInstances.length;
  return {
    running: runningBotCount > 0,
    starting,
    botCount: runningBotCount,
    configuredBotCount,
    needsRestart: runningBotCount > 0 && runningBotCount !== configuredBotCount,
  };
}

export async function startBotFromGui() {
  if (starting) {
    return { ok: false, error: 'Bot is already starting.' };
  }
  starting = true;
  try {
    reloadConfig();
    assertBotConfigReady();
    const tokens = getConfig().telegramBotTokens || [];
    if (botInstances.length > 0) {
      if (botInstances.length === tokens.length) {
        return {
          ok: false,
          error: 'All configured bots are already running. Stop the bot, add tokens, then start again.',
        };
      }
      logger.info('Bot token list changed — restarting all Telegram bots…');
      await stopBotFromGui();
    }
    await getPool();
    const llama = await startLlamaServerIfConfigured(true);
    if (!llama.ok) {
      return { ok: false, error: llama.error || 'Could not start llama-server' };
    }
    const reach = await ensureLlamaServerReachable();
    if (!reach.ok) {
      await stopLlamaServerIfWeStarted().catch(() => {});
      return { ok: false, error: reach.error || 'llama-server unreachable' };
    }
    const created = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const bot = await createBot(tokens[i], i);
      created.push(bot);
    }
    botInstances = created;
    return { ok: true, botCount: botInstances.length, configuredBotCount: tokens.length };
  } catch (e) {
    logger.error(`GUI start bot: ${e.message}`);
    for (const b of botInstances) {
      try {
        await b.stopPolling({ cancel: true });
      } catch {
        /* ignore */
      }
    }
    botInstances = [];
    await stopLlamaServerIfWeStarted().catch(() => {});
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
    for (const b of running) {
      await b.stopPolling({ cancel: true });
    }
    botInstances = [];
    await stopLlamaServerIfWeStarted();
    logger.info('Telegram polling stopped (GUI, all bots)');
    return { ok: true, botCount: 0 };
  } catch (e) {
    logger.error(`stopPolling: ${e.message}`);
    botInstances = [];
    return { ok: false, error: e.message || String(e) };
  }
}
