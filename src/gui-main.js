import fs from 'fs';
import { spawn } from 'child_process';
import { getConfig, reloadConfig } from './config.js';
import { startGuiServer } from './gui/server.js';
import { stopBotFromGui } from './gui/bot-runner.js';
import { stopLlamaServerIfWeStarted } from './llm/llamaProcess.js';
import { logger } from './logger.js';
import { closeBrowser } from './tools/browser.js';

reloadConfig();
try {
  fs.mkdirSync(getConfig().modelsDir, { recursive: true });
  fs.mkdirSync(getConfig().engineDir, { recursive: true });
} catch (e) {
  logger.warn(`Folder init: ${e.message}`);
}
const port = getConfig().guiPort;

try {
  await startGuiServer(port);
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    logger.error(
      `Port ${port} is already in use — usually another Control Panel is still running.`
    );
    logger.error(
      `Fix: close that terminal/process, or use a different port in .env or data/settings.json (GUI_PORT), then run npm run gui again.`
    );
    if (process.platform === 'win32') {
      logger.info(`Find PID: netstat -ano | findstr :${port}`);
      logger.info(`Then: taskkill /PID <pid> /F`);
    }
  } else {
    logger.error(`GUI server failed: ${e.message}`);
  }
  process.exit(1);
}

async function shutdown(signal) {
  logger.info(`Shutting down (${signal || 'exit'})`);
  await stopBotFromGui().catch(() => {});
  await stopLlamaServerIfWeStarted().catch(() => {});
  await closeBrowser().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (getConfig().openBrowserGui) {
  const url = `http://127.0.0.1:${port}`;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    logger.info(`Open manually: ${url}`);
  }
}
