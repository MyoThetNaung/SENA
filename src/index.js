import fs from 'fs';
import { createBot } from './bot/telegram.js';
import { assertBotConfigReady, getConfig } from './config.js';
import { getPool } from './db.js';
import { ensureLlmBackendReachable } from './llm/llamaProcess.js';
import { logger } from './logger.js';
import { closeBrowser } from './tools/browser.js';
import { registerRunningBots } from './reminders/telegramDelivery.js';
import { startReminderScheduler } from './reminders/scheduler.js';

try {
  assertBotConfigReady();
} catch (e) {
  logger.error(`${e.message}`);
  process.exit(1);
}

const cfg = getConfig();
logger.info(
  `LLM backend=${cfg.llmProvider} model=${cfg.llmModel} | Ollama=${cfg.ollamaBaseUrl} | llama-server=${cfg.llamaServerUrl}` +
    (cfg.llmProvider === 'openai'
      ? ' | OpenAI cloud'
      : cfg.llmProvider === 'openrouter'
        ? ' | OpenRouter cloud'
        : cfg.llmProvider === 'gemini'
          ? ' | Gemini cloud'
          : '')
);
try {
  fs.mkdirSync(cfg.modelsDir, { recursive: true });
  fs.mkdirSync(cfg.engineDir, { recursive: true });
} catch (e) {
  logger.warn(`Folder init: ${e.message}`);
}
await getPool();

try {
  const reach = await ensureLlmBackendReachable();
  if (!reach.ok) {
    logger.error(reach.error || 'LLM backend unreachable');
    process.exit(1);
  }
  const botEntries = [];
  for (const [idx, token] of (cfg.telegramBotTokens || []).entries()) {
    const entry = await createBot(token, idx);
    botEntries.push({ token, bot: entry.bot, botId: entry.botId });
  }
  registerRunningBots(botEntries);
  startReminderScheduler();
} catch (e) {
  logger.error(`Startup failed: ${e.message}`);
  process.exit(1);
}

async function shutdown(signal) {
  logger.info(`Shutting down (${signal})`);
  try {
    await closeBrowser();
  } catch (e) {
    logger.warn(`Browser close: ${e.message}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
