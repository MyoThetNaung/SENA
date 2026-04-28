import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, reloadConfig } from './config.js';
import { startGuiServer } from './gui/server.js';
import { stopBotFromGui } from './gui/bot-runner.js';
import { stopLlamaServerIfWeStarted } from './llm/llamaProcess.js';
import { logger } from './logger.js';
import { closeBrowser } from './tools/browser.js';

let win = null;
app.setName('SENA');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error?.stack || error?.message || error}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason?.stack || reason?.message || reason}`);
});

async function shutdown(reason = 'exit') {
  logger.info(`Shutting down (${reason})`);
  await stopBotFromGui().catch(() => {});
  await stopLlamaServerIfWeStarted().catch(() => {});
  await closeBrowser().catch(() => {});
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1580,
    height: 1020,
    minWidth: 1320,
    minHeight: 860,
    autoHideMenuBar: true,
    title: 'SENA',
    backgroundColor: '#0b0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0f14',
      symbolColor: '#dbe9ff',
      height: 34,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
  });
  win.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle('SENA');
  });
  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.loadURL(url);
}

ipcMain.handle('window:minimize', () => {
  win?.minimize();
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  win?.close();
});

async function boot() {
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
      logger.error(`Port ${port} is already in use.`);
      logger.error(
        'Close previous Control Panel process or change GUI_PORT in settings, then relaunch.'
      );
    } else {
      logger.error(`GUI server failed: ${e.message}`);
    }
    app.quit();
    return;
  }

  const url = `http://127.0.0.1:${port}`;
  createWindow(url);
}

app.whenReady().then(async () => {
  // Remove native app menu globally.
  Menu.setApplicationMenu(null);
  await boot();
});

app.on('render-process-gone', (_event, _webContents, details) => {
  logger.error(`Renderer process gone: ${details.reason}`);
});

app.on('child-process-gone', (_event, details) => {
  logger.error(`Child process gone: ${details.type} ${details.reason}`);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const port = getConfig().guiPort;
    createWindow(`http://127.0.0.1:${port}`);
  }
});

app.on('window-all-closed', async () => {
  await shutdown('window-all-closed');
  app.quit();
});

