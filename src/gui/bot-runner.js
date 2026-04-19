import { createBot } from '../bot/telegram.js';
import { assertBotConfigReady, reloadConfig } from '../config.js';
import { getDb } from '../db.js';
import {
  startLlamaServerIfConfigured,
  stopLlamaServerIfWeStarted,
  ensureLlamaServerReachable,
} from '../llm/llamaProcess.js';
import { logger } from '../logger.js';

let botInstance = null;
let starting = false;

export function getBotStatus() {
  return { running: Boolean(botInstance), starting };
}

export async function startBotFromGui() {
  if (botInstance) {
    return { ok: false, error: 'Bot is already running.' };
  }
  if (starting) {
    return { ok: false, error: 'Bot is already starting.' };
  }
  starting = true;
  try {
    reloadConfig();
    assertBotConfigReady();
    getDb();
    const llama = await startLlamaServerIfConfigured(true);
    if (!llama.ok) {
      return { ok: false, error: llama.error || 'Could not start llama-server' };
    }
    const reach = await ensureLlamaServerReachable();
    if (!reach.ok) {
      await stopLlamaServerIfWeStarted().catch(() => {});
      return { ok: false, error: reach.error || 'llama-server unreachable' };
    }
    botInstance = await createBot();
    return { ok: true };
  } catch (e) {
    logger.error(`GUI start bot: ${e.message}`);
    botInstance = null;
    await stopLlamaServerIfWeStarted().catch(() => {});
    return { ok: false, error: e.message || String(e) };
  } finally {
    starting = false;
  }
}

export async function stopBotFromGui() {
  if (!botInstance) {
    return { ok: false, error: 'Bot is not running.' };
  }
  try {
    await botInstance.stopPolling({ cancel: true });
    botInstance = null;
    await stopLlamaServerIfWeStarted();
    logger.info('Telegram polling stopped (GUI)');
    return { ok: true };
  } catch (e) {
    logger.error(`stopPolling: ${e.message}`);
    botInstance = null;
    return { ok: false, error: e.message || String(e) };
  }
}
