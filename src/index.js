import fs from 'fs';
import { createBot } from './bot/telegram.js';
import { assertBotConfigReady, getConfig } from './config.js';
import { getDb } from './db.js';
import {
  startLlamaServerIfConfigured,
  stopLlamaServerIfWeStarted,
  ensureLlamaServerReachable,
} from './llm/llamaProcess.js';
import { logger } from './logger.js';
import { closeBrowser } from './tools/browser.js';

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
getDb();

try {
  const llama = await startLlamaServerIfConfigured(false);
  if (!llama.ok) {
    logger.error(llama.error || 'llama-server autostart failed');
    process.exit(1);
  }
  const reach = await ensureLlamaServerReachable();
  if (!reach.ok) {
    logger.error(reach.error || 'llama-server unreachable');
    process.exit(1);
  }
  for (const [idx, token] of (cfg.telegramBotTokens || []).entries()) {
    await createBot(token, idx);
  }
} catch (e) {
  logger.error(`Startup failed: ${e.message}`);
  await stopLlamaServerIfWeStarted().catch(() => {});
  process.exit(1);
}

async function shutdown(signal) {
  logger.info(`Shutting down (${signal})`);
  try {
    await closeBrowser();
  } catch (e) {
    logger.warn(`Browser close: ${e.message}`);
  }
  await stopLlamaServerIfWeStarted().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
