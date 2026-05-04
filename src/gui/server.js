import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getConfig,
  reloadConfig,
  saveSettingsToDisk,
  getSettingsPath,
  projectRoot,
} from '../config.js';
import {
  appendChatMessage,
  clearChatMessagesForUser,
  listChatMessages,
  listChatUserIds,
  listChatSessions,
} from '../chat/chatLog.js';
import {
  getSoul,
  listSouls,
  setSoulContent,
  clearSoul,
  copySoulFromTo,
  copyBotPersonaFromTo,
} from '../memory/soul.js';
import { clearAllStoredMemory } from '../memory/clearAllMemory.js';
import { scheduleMemorySummaryRefresh } from '../memory/conversationSummary.js';
import { resetDatabaseConnection, getDb } from '../db.js';
import { listAllEvents, deleteEventById } from '../calendar/calendar.js';
import { deleteUserRecordById, listUserRecords } from '../records/userRecords.js';
import { listAllPending, clearPending } from '../core/pending.js';
import {
  listTelegramUsers,
  setTelegramUserStatus,
  setTelegramUserName,
  getTelegramLabelsForUserIds,
  clearTelegramAccessRecords,
  listKnownTelegramBots,
  SCOPED_USER_ID_OFFSET,
} from '../access/telegramAccess.js';
import { handleTextMessage } from '../core/orchestrator.js';
import { GUI_CONSOLE_USER_ID } from '../const/guiSession.js';
import { buildModelCatalog, probeLlamaServerReachable, normalizeCatalogLlmProvider } from '../llm/catalog.js';
import { fetchOpenAiModelNames, fetchOpenRouterModelNames, fetchGeminiModelNames } from '../llm/cloudLlm.js';
import { startBotFromGui, stopBotFromGui, getBotStatus } from './bot-runner.js';
import {
  startLlamaServerIfConfigured,
  stopLlamaServerIfWeStarted,
  llamaProcessRunning,
} from '../llm/llamaProcess.js';
import { logger, syncLoggerLevel } from '../logger.js';
import { getLlmUsageStats } from '../llm/tokenUsage.js';
import { getHardwareSnapshot } from './hardwareStats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

function maskToken(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function isValidTelegramBotToken(raw) {
  const t = String(raw ?? '').trim();
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(t);
}

function listGgufInFolder(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { folder: dir, files: [], error: 'Could not access folder' };
  }
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return { folder: dir, files: [], error: e.message };
  }
  const files = names
    .filter((n) => n.toLowerCase().endsWith('.gguf'))
    .map((n) => {
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        return {
          name: n,
          sizeBytes: st.size,
          modified: st.mtime.toISOString(),
        };
      } catch {
        return { name: n, sizeBytes: 0, modified: null };
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { folder: dir, files };
}


function readSettingsForApi() {
  reloadConfig();
  syncLoggerLevel();
  const c = getConfig();
  const rawPath = getSettingsPath();
  let fileExists = false;
  let raw = {};
  try {
    fileExists = fs.existsSync(rawPath);
    if (fileExists) raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  } catch {
    /* ignore */
  }
  const effectiveTokens = Array.isArray(c.telegramBotTokens) ? c.telegramBotTokens : [];
  const hasSavedToken = effectiveTokens.length > 0;
  const fileOpenai = String(raw.openaiApiKey || '').trim();
  const envOpenai = String(process.env.OPENAI_API_KEY || '').trim();
  const hasOpenAiKey = Boolean(fileOpenai || envOpenai);
  const fileOpenRouter = String(raw.openrouterApiKey || '').trim();
  const envOpenRouter = String(process.env.OPENROUTER_API_KEY || '').trim();
  const hasOpenRouterKey = Boolean(fileOpenRouter || envOpenRouter);
  const fileGem = String(raw.geminiApiKey || '').trim();
  const envGem = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const hasGeminiKey = Boolean(fileGem || envGem);
  const gguf = listGgufInFolder(c.modelsDir);
  const databasePathInput =
    raw.databasePath != null && String(raw.databasePath).trim() !== ''
      ? String(raw.databasePath).trim()
      : c.databasePathDisplay;
  const modelsDirInput =
    raw.modelsDir != null && String(raw.modelsDir).trim() !== ''
      ? String(raw.modelsDir).trim()
      : 'models';
  const engineDirInput =
    raw.engineDir != null && String(raw.engineDir).trim() !== ''
      ? String(raw.engineDir).trim()
      : 'engine';

  const out = {
    projectRoot,
    telegramBotTokenMasked: maskToken(c.telegramBotToken),
    telegramBotTokensMasked: effectiveTokens.map((t) => maskToken(t)).filter(Boolean),
    telegramBotCount: effectiveTokens.length,
    hasSavedToken,
    llmProvider: c.llmProvider,
    ollamaBaseUrl: c.ollamaBaseUrl,
    llamaServerUrl: c.llamaServerUrl,
    llmModel: c.llmModel,
    ollamaModel: c.llmModel,
    guiPort: c.guiPort,
    logLevel: c.logLevel,
    browserTimeoutMs: c.browserTimeoutMs,
    maxBrowsePages: c.maxBrowsePages,
    webSearchEnabled: c.webSearchEnabled,
    databasePath: databasePathInput,
    databasePathResolved: c.databasePath,
    modelsDir: c.modelsDir,
    modelsDirInput,
    engineDir: c.engineDir,
    engineDirInput,
    openBrowserGui: c.openBrowserGui,
    autoStartLlamaServer: c.autoStartLlamaServer,
    botPersona: c.botPersona,
    botPersonaByBotId: c.botPersonaByBotId || {},
    memoryBotNamesById: c.memoryBotNamesById || {},
    settingsPath: rawPath,
    settingsFileExists: fileExists,
    ggufFolder: gguf.folder,
    ggufFiles: gguf.files,
    hasOpenAiKey,
    hasOpenRouterKey,
    hasGeminiKey,
    openaiApiKeyMasked: maskToken(c.openaiApiKey),
    openrouterApiKeyMasked: maskToken(c.openrouterApiKey),
    openrouterBaseUrl: c.openrouterBaseUrl,
    geminiApiKeyMasked: maskToken(c.geminiApiKey),
  };
  if (gguf.error) out.ggufError = gguf.error;
  return out;
}

export function createGuiApp() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.use(express.static(publicDir));

  app.get('/api/settings', (req, res) => {
    try {
      res.json(readSettingsForApi());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings', (req, res) => {
    try {
      const b = req.body || {};
      const prevDb = getConfig().databasePath;
      const patch = {};

      if (typeof b.telegramBotToken === 'string') {
        const t = b.telegramBotToken.trim();
        if (t) {
          if (!isValidTelegramBotToken(t)) throw new Error('Invalid Telegram bot token format.');
          patch.telegramBotToken = t;
          patch.telegramBotTokens = [t];
        }
      }
      if (typeof b.telegramBotTokenAdd === 'string') {
        const t = b.telegramBotTokenAdd.trim();
        if (t) {
          if (!isValidTelegramBotToken(t)) throw new Error('Invalid Telegram bot token format.');
          const current = Array.isArray(getConfig().telegramBotTokens) ? getConfig().telegramBotTokens : [];
          patch.telegramBotTokens = [...new Set([...current, t])];
          patch.telegramBotToken = patch.telegramBotTokens[0] || t;
        }
      }
      if (b.telegramBotTokensClear === true) {
        patch.telegramBotTokens = null;
        patch.telegramBotToken = null;
      }
      if (typeof b.llmProvider === 'string') {
        const p = b.llmProvider.toLowerCase();
        const map = {
          ollama: 'ollama',
          'llama-server': 'llama-server',
          llamacpp: 'llama-server',
          openai: 'openai',
          openrouter: 'openrouter',
          gemini: 'gemini',
          google: 'gemini',
        };
        if (map[p]) patch.llmProvider = map[p];
      }
      if (typeof b.openaiApiKey === 'string') {
        const t = b.openaiApiKey.trim();
        if (t) patch.openaiApiKey = t;
      }
      if (typeof b.geminiApiKey === 'string') {
        const t = b.geminiApiKey.trim();
        if (t) patch.geminiApiKey = t;
      }
      if (typeof b.openrouterApiKey === 'string') {
        const t = b.openrouterApiKey.trim();
        if (t) patch.openrouterApiKey = t;
      }
      if (typeof b.ollamaBaseUrl === 'string' && b.ollamaBaseUrl.trim()) {
        patch.ollamaBaseUrl = b.ollamaBaseUrl.trim().replace(/\/$/, '');
      }
      if (typeof b.llamaServerUrl === 'string' && b.llamaServerUrl.trim()) {
        patch.llamaServerUrl = b.llamaServerUrl.trim().replace(/\/$/, '');
      }
      if (typeof b.openrouterBaseUrl === 'string' && b.openrouterBaseUrl.trim()) {
        patch.openrouterBaseUrl = b.openrouterBaseUrl.trim().replace(/\/$/, '');
      }
      const modelPick =
        typeof b.llmModel === 'string' && b.llmModel.trim()
          ? b.llmModel.trim()
          : typeof b.ollamaModel === 'string' && b.ollamaModel.trim()
            ? b.ollamaModel.trim()
            : null;
      if (modelPick) {
        patch.llmModel = modelPick;
        patch.ollamaModel = modelPick;
      }
      if (b.guiPort != null && b.guiPort !== '') {
        const p = Number(b.guiPort);
        if (Number.isFinite(p)) patch.guiPort = Math.min(65535, Math.max(1024, p));
      }
      if (typeof b.logLevel === 'string' && b.logLevel.trim()) {
        patch.logLevel = b.logLevel.trim();
      }
      if (b.browserTimeoutMs != null && b.browserTimeoutMs !== '') {
        const n = Number(b.browserTimeoutMs);
        if (Number.isFinite(n)) patch.browserTimeoutMs = Math.min(60000, Math.max(1000, n));
      }
      if (b.maxBrowsePages != null && b.maxBrowsePages !== '') {
        const n = Number(b.maxBrowsePages);
        if (Number.isFinite(n)) patch.maxBrowsePages = Math.min(2, Math.max(1, n));
      }
      if (typeof b.webSearchEnabled === 'boolean') {
        patch.webSearchEnabled = b.webSearchEnabled;
      }
      if (typeof b.databasePath === 'string') {
        const d = b.databasePath.trim();
        patch.databasePath = d || null;
      }
      if (typeof b.modelsDir === 'string') {
        const m = b.modelsDir.trim();
        patch.modelsDir = m || null;
      }
      if (typeof b.engineDir === 'string') {
        const ed = b.engineDir.trim();
        patch.engineDir = ed || null;
      }
      if (typeof b.openBrowserGui === 'boolean') {
        patch.openBrowser = b.openBrowserGui;
      }
      if (typeof b.autoStartLlamaServer === 'boolean') {
        patch.autoStartLlamaServer = b.autoStartLlamaServer;
      }
      if (b.botPersona && typeof b.botPersona === 'object' && !Array.isArray(b.botPersona)) {
        const bp = b.botPersona;
        patch.botPersona = {
          displayName: typeof bp.displayName === 'string' ? bp.displayName : '',
          displayNameMy: typeof bp.displayNameMy === 'string' ? bp.displayNameMy : '',
          gender: typeof bp.gender === 'string' ? bp.gender : '',
          style: typeof bp.style === 'string' ? bp.style : '',
          role: typeof bp.role === 'string' ? bp.role : '',
          addressUserEn: typeof bp.addressUserEn === 'string' ? bp.addressUserEn : '',
          addressUserMy: typeof bp.addressUserMy === 'string' ? bp.addressUserMy : '',
        };
      }
      if (
        b.botPersonaByBotId &&
        typeof b.botPersonaByBotId === 'object' &&
        !Array.isArray(b.botPersonaByBotId)
      ) {
        const out = {};
        for (const [k, raw] of Object.entries(b.botPersonaByBotId)) {
          if (!/^\d+$/.test(String(k))) continue;
          const bp = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
          out[String(k)] = {
            displayName: typeof bp.displayName === 'string' ? bp.displayName : '',
            displayNameMy: typeof bp.displayNameMy === 'string' ? bp.displayNameMy : '',
            gender: typeof bp.gender === 'string' ? bp.gender : '',
            style: typeof bp.style === 'string' ? bp.style : '',
            role: typeof bp.role === 'string' ? bp.role : '',
            addressUserEn: typeof bp.addressUserEn === 'string' ? bp.addressUserEn : '',
            addressUserMy: typeof bp.addressUserMy === 'string' ? bp.addressUserMy : '',
          };
        }
        patch.botPersonaByBotId = out;
      }
      if (
        b.memoryBotNamesById &&
        typeof b.memoryBotNamesById === 'object' &&
        !Array.isArray(b.memoryBotNamesById)
      ) {
        const out = {};
        for (const [k, raw] of Object.entries(b.memoryBotNamesById)) {
          if (!/^\d+$/.test(String(k))) continue;
          const name = String(raw ?? '').trim();
          if (name) out[String(k)] = name;
        }
        patch.memoryBotNamesById = out;
      }

      saveSettingsToDisk(patch);
      const nextDb = getConfig().databasePath;
      if (nextDb !== prevDb) {
        resetDatabaseConnection();
      }
      syncLoggerLevel();
      res.json({ ok: true, settings: readSettingsForApi() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  /** Saved tokens + bot naming/persona metadata + SQLite access list. Stops bot if running. Does not edit .env. */
  app.post('/api/settings/reset-telegram', async (req, res) => {
    try {
      const stopOut = await stopBotFromGui();
      if (!stopOut.ok && stopOut.error !== 'Bot is not running.') {
        logger.warn(`reset-telegram: could not stop bot cleanly: ${stopOut.error}`);
      }
      saveSettingsToDisk({
        telegramBotToken: null,
        telegramBotTokens: null,
        memoryBotNamesById: null,
        botPersonaByBotId: null,
      });
      clearTelegramAccessRecords();
      syncLoggerLevel();
      res.json({ ok: true, settings: readSettingsForApi() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/system/hardware', async (req, res) => {
    try {
      const data = await getHardwareSnapshot();
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/bot/status', (req, res) => {
    res.json({ ...getBotStatus() });
  });

  app.post('/api/bot/start', async (req, res) => {
    const out = await startBotFromGui();
    if (!out.ok) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  });

  app.post('/api/bot/stop', async (req, res) => {
    const out = await stopBotFromGui();
    if (!out.ok) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  });

  app.get('/api/llm/server-status', async (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      const spawnedByApp = llamaProcessRunning();
      let listening = false;
      let ollamaReachable = false;
      let cloudReachable = false;
      if (c.llmProvider === 'llama-server') {
        const url = c.llamaServerUrl.replace(/\/$/, '');
        listening = await probeLlamaServerReachable(url, 3000);
      } else if (c.llmProvider === 'ollama') {
        const ob = c.ollamaBaseUrl.replace(/\/$/, '');
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const probe = await fetch(`${ob}/api/tags`, { signal: ctrl.signal });
          clearTimeout(t);
          ollamaReachable = probe.ok;
        } catch {
          ollamaReachable = false;
        }
      } else if (c.llmProvider === 'openai') {
        const r = await fetchOpenAiModelNames(c.openaiApiKey);
        cloudReachable = r.ok;
      } else if (c.llmProvider === 'openrouter') {
        const r = await fetchOpenRouterModelNames(c.openrouterApiKey, c.openrouterBaseUrl);
        cloudReachable = r.ok;
      } else if (c.llmProvider === 'gemini') {
        const r = await fetchGeminiModelNames(c.geminiApiKey);
        cloudReachable = r.ok;
      }
      const backendUrl =
        c.llmProvider === 'llama-server'
          ? c.llamaServerUrl
          : c.llmProvider === 'ollama'
            ? c.ollamaBaseUrl
            : c.llmProvider === 'openai'
              ? 'https://api.openai.com/v1'
              : c.llmProvider === 'openrouter'
                ? c.openrouterBaseUrl
              : c.llmProvider === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : '';
      const online =
        c.llmProvider === 'llama-server'
          ? listening
          : c.llmProvider === 'ollama'
            ? ollamaReachable
            : c.llmProvider === 'openai' || c.llmProvider === 'openrouter' || c.llmProvider === 'gemini'
              ? cloudReachable
              : false;
      res.json({
        provider: c.llmProvider,
        url: backendUrl,
        spawnedByApp,
        listening,
        ollamaReachable,
        online,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/llm/start-server', async (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      if (c.llmProvider !== 'llama-server') {
        res.status(400).json({
          ok: false,
          error: 'Set LLM backend to llama.cpp server (Engine tab), save, then try again.',
        });
        return;
      }
      const out = await startLlamaServerIfConfigured(true);
      if (!out.ok) {
        res.status(400).json({ ok: false, error: out.error || 'Start failed' });
        return;
      }
      res.json({ ok: true, skipped: out.skipped });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/llm/stop-server', async (req, res) => {
    try {
      await stopLlamaServerIfWeStarted();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/chat/sessions', (req, res) => {
    try {
      getDb();
      const sessions = listChatSessions();
      const ids = sessions.map((s) => s.userId);
      const labels = getTelegramLabelsForUserIds(ids);
      const out = sessions.map((s) => ({
        userId: s.userId,
        lastAt: s.lastAt,
        label: labels.get(s.userId) || String(s.userId),
      }));
      res.json({ guiConsoleUserId: GUI_CONSOLE_USER_ID, sessions: out });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chat/send', async (req, res) => {
    try {
      reloadConfig();
      getDb();
      const userId = Number((req.body || {}).userId);
      const text = String((req.body || {}).text ?? '').trim();
      if (!text) {
        res.status(400).json({ ok: false, error: 'Message text is required.' });
        return;
      }
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      appendChatMessage(userId, 'user', text);
      try {
        const out = await handleTextMessage(userId, text);
        appendChatMessage(userId, 'assistant', out.reply);
        scheduleMemorySummaryRefresh(userId);
        res.json({
          ok: true,
          reply: out.reply,
          wantConfirmKeyboard: Boolean(out.wantConfirmKeyboard),
        });
      } catch (e) {
        const errText = `Error: ${e.message}`;
        appendChatMessage(userId, 'assistant', errText);
        res.status(500).json({ ok: false, error: e.message });
      }
    } catch (e) {
      logger.error(`GUI chat send: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/chat', (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const userId = req.query.userId != null && req.query.userId !== '' ? Number(req.query.userId) : null;
      const rows = listChatMessages({
        userId: Number.isFinite(userId) ? userId : null,
        limit,
      });
      const userIds = listChatUserIds();
      res.json({ messages: rows, userIds, guiConsoleUserId: GUI_CONSOLE_USER_ID });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chat/clear-session', (req, res) => {
    try {
      getDb();
      const userId = Number((req.body || {}).userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      const deleted = clearChatMessagesForUser(userId);
      res.json({ ok: true, deleted });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/models', (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      const out = listGgufInFolder(c.modelsDir);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/llm/catalog', async (req, res) => {
    try {
      reloadConfig();
      const override = normalizeCatalogLlmProvider(req.query?.llmProvider);
      const catalog = await buildModelCatalog(override ? { llmProvider: override } : {});
      res.json(catalog);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/summary', (req, res) => {
    try {
      const db = getDb();
      const chatCount = db.prepare('SELECT COUNT(*) as c FROM chat_log').get().c;
      const eventsCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
      let recordsCount = 0;
      try {
        recordsCount = db.prepare('SELECT COUNT(*) as c FROM user_records').get().c;
      } catch {
        /* table missing before migrate */
      }
      const soulsCount = db.prepare('SELECT COUNT(*) as c FROM soul').get().c;
      const pendingCount = db.prepare('SELECT COUNT(*) as c FROM pending_confirm').get().c;
      let accessPending = 0;
      try {
        accessPending = db.prepare(`SELECT COUNT(*) as c FROM telegram_users WHERE status = 'pending'`).get().c;
      } catch {
        /* table missing before migrate */
      }
      res.json({ chatCount, eventsCount, recordsCount, soulsCount, pendingCount, accessPending });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/stats/llm-usage', (req, res) => {
    try {
      getDb();
      const provider = String(req.query?.provider || '').trim().toLowerCase();
      const providerFilter = provider || null;
      res.json(getLlmUsageStats(providerFilter));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/access/users', (req, res) => {
    try {
      reloadConfig();
      getDb();
      const status = req.query.status || null;
      const rows = listTelegramUsers(status);
      res.json({ users: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/access/set', (req, res) => {
    try {
      const b = req.body || {};
      const userId = Number(b.userId);
      const status = String(b.status || '').toLowerCase();
      const hasUsername = Object.prototype.hasOwnProperty.call(b, 'username');
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Invalid userId' });
        return;
      }
      if (status && !['approved', 'blocked', 'pending'].includes(status)) {
        res.status(400).json({ ok: false, error: 'status must be approved, blocked, or pending' });
        return;
      }
      if (!status && !hasUsername) {
        res.status(400).json({ ok: false, error: 'No updates provided' });
        return;
      }
      getDb();
      if (status) setTelegramUserStatus(userId, status);
      if (hasUsername) setTelegramUserName(userId, b.username);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/access/clear-all', (req, res) => {
    try {
      getDb();
      clearTelegramAccessRecords();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/memory/sessions', (req, res) => {
    try {
      getDb();
      const botId = req.query.botId != null && req.query.botId !== '' ? Number(req.query.botId) : null;
      const scopedRows = Number.isFinite(botId)
        ? getDb()
            .prepare('SELECT id FROM telegram_identity_map WHERE bot_id = ?')
            .all(botId)
        : [];
      const scopedSet = new Set(
        scopedRows.map((r) => SCOPED_USER_ID_OFFSET + Number(r.id)).filter((n) => Number.isFinite(n))
      );
      const fromChat = Number.isFinite(botId)
        ? listChatUserIds().filter((id) => scopedSet.has(Number(id)))
        : listChatUserIds();
      const soulRows = listSouls(Number.isFinite(botId) ? { botId } : {});
      const fromSoul = soulRows.map((s) => s.user_id);
      const set = new Set([...fromChat, ...fromSoul]);
      if (!Number.isFinite(botId)) {
        set.add(GUI_CONSOLE_USER_ID);
      }
      const ids = [...set].sort((a, b) => {
        if (a === GUI_CONSOLE_USER_ID) return -1;
        if (b === GUI_CONSOLE_USER_ID) return 1;
        return a - b;
      });
      const labels = getTelegramLabelsForUserIds(ids);
      const sessions = ids.map((userId) => ({
        userId,
        label:
          userId === GUI_CONSOLE_USER_ID
            ? 'Control panel (local test)'
            : labels.get(userId) || String(userId),
      }));
      res.json({ guiConsoleUserId: GUI_CONSOLE_USER_ID, sessions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/soul/:userId', (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      getDb();
      res.json(getSoul(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/soul/:userId', (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      const b = req.body || {};
      getDb();
      setSoulContent(userId, {
        display_name: b.display_name,
        profile: b.profile,
        botPersona: b.botPersona,
      });
      res.json({ ok: true, soul: getSoul(userId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/:userId/clear', (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      getDb();
      clearSoul(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/copy', (req, res) => {
    try {
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
        res.status(400).json({ ok: false, error: 'fromUserId and toUserId must be numbers' });
        return;
      }
      getDb();
      copySoulFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: getSoul(toUserId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/copy-bot-persona', (req, res) => {
    try {
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
        res.status(400).json({ ok: false, error: 'fromUserId and toUserId must be numbers' });
        return;
      }
      getDb();
      copyBotPersonaFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: getSoul(toUserId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/memory/clear-all', (req, res) => {
    try {
      const confirm = String((req.body || {}).confirm || '').trim();
      if (confirm !== 'DELETE ALL') {
        res.status(400).json({
          ok: false,
          error: 'Refused. Send JSON body: { "confirm": "DELETE ALL" }',
        });
        return;
      }
      getDb();
      clearAllStoredMemory();
      logger.warn('clear-all-memory: wiped pending_confirm, chat_log, soul (events & user_records CASCADE)');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/data/souls', (req, res) => {
    try {
      const botId = req.query.botId != null && req.query.botId !== '' ? Number(req.query.botId) : null;
      const rows = listSouls(Number.isFinite(botId) ? { botId } : {});
      res.json({ souls: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory/bots', (req, res) => {
    try {
      getDb();
      res.json({ bots: listKnownTelegramBots() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/calendar', (req, res) => {
    try {
      const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 400));
      const rows = listAllEvents(limit);
      res.json({ events: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/pending', (req, res) => {
    try {
      const rows = listAllPending();
      res.json({ pending: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/data/calendar/delete', (req, res) => {
    try {
      getDb();
      const id = Number((req.body || {}).id);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ ok: false, error: 'Valid event id is required.' });
        return;
      }
      const ok = deleteEventById(id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'No event with that id.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/data/records', (req, res) => {
    try {
      getDb();
      const userId = Number(req.query.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Query userId is required.' });
        return;
      }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const rt = String(req.query.recordType || '').toLowerCase();
      const filter = rt === 'purchase' || rt === 'medicine' ? rt : null;
      const rows = listUserRecords(userId, { limit, record_type: filter });
      res.json({ records: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/data/records/delete', (req, res) => {
    try {
      getDb();
      const userId = Number((req.body || {}).userId);
      const id = Number((req.body || {}).id);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ ok: false, error: 'Valid record id is required.' });
        return;
      }
      const ok = deleteUserRecordById(userId, id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'No record with that id for this user.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/data/pending/delete', (req, res) => {
    try {
      getDb();
      const userId = Number((req.body || {}).userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      clearPending(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, cwd: projectRoot });
  });

  return app;
}

export async function startGuiServer(port) {
  const app = createGuiApp();
  const host = String(process.env.GUI_HOST || '0.0.0.0').trim() || '0.0.0.0';
  const bindHost = host.toLowerCase() === 'localhost' ? '127.0.0.1' : host;
  const logHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost;
  return new Promise((resolve, reject) => {
    const server = app.listen(port, bindHost, () => {
      logger.info(`Control Panel: http://${logHost}:${port}`);
      if (bindHost === '0.0.0.0') {
        logger.info(`LAN access enabled on port ${port} (use your PC IP from other devices).`);
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}
