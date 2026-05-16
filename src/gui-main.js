import { spawn } from 'child_process';
import fs from 'fs';
import { getConfig, reloadConfig } from './config.js';
import { startSenaWebServer } from './web/startServer.js';
import { logger } from './logger.js';

reloadConfig();
try {
  fs.mkdirSync(getConfig().modelsDir, { recursive: true });
  fs.mkdirSync(getConfig().engineDir, { recursive: true });
} catch (e) {
  logger.warn(`Folder init: ${e.message}`);
}

const port = getConfig().guiPort;

try {
  const web = await startSenaWebServer({ port });
  if (getConfig().openBrowserGui) {
    const url = `${web.url}/admin.html`;
    const open =
      process.platform === 'win32'
        ? () => spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
        : process.platform === 'darwin'
          ? () => spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
          : () => spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    try {
      open();
    } catch {
      logger.info(`Open manually: ${url}`);
    }
  }
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    logger.error(`Port ${port} is already in use.`);
    logger.error('Close the other SENA process or change GUI_PORT, then try again.');
  } else {
    logger.error(`Web server failed: ${e.message}`);
  }
  process.exit(1);
}
