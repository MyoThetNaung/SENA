import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';
import {
  getConfig,
  reloadConfig,
  saveSettingsToDisk,
  getSettingsPath,
  projectRoot,
  resolveUserPath,
  isLlamaServerRemote,
  migrateLegacyLlamaServerSettings,
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
import { resetDatabaseConnection, getPool, query } from '../db.js';
import { listAllEvents, deleteEventById } from '../calendar/calendar.js';
import { deleteUserRecordById, listUserRecords } from '../records/userRecords.js';
import { listAllPending, clearPending } from '../core/pending.js';
import {
  listTelegramUsers,
  setTelegramUserName,
  getTelegramLabelsForUserIds,
  clearTelegramAccessRecords,
  SCOPED_USER_ID_OFFSET,
} from '../access/telegramAccess.js';
import {
  listConfiguredTelegramBots,
  resolveTelegramBotIdFromToken,
  removeBotScopedMapKeys,
} from '../access/telegramBots.js';
import { handleImageMessage, handleTextMessage } from '../core/orchestrator.js';
import { GUI_CONSOLE_USER_ID } from '../const/guiSession.js';
import {
  buildModelCatalog,
  probeLlamaServerReachable,
  fetchLlamaServerModelNames,
  normalizeCatalogLlmProvider,
  fetchOllamaModelNames,
} from '../llm/catalog.js';
import { fetchOpenAiModelNames, fetchOpenRouterModelNames, fetchGeminiModelNames } from '../llm/cloudLlm.js';
import { startBotFromGui, stopBotFromGui, getBotStatus } from './bot-runner.js';
import {
  startLlamaServerIfConfigured,
  startOllamaServerIfConfigured,
  stopLlamaServerIfWeStarted,
  llamaProcessRunning,
  embeddedLlmProcessRunning,
  startEmbeddedLlamaServerFromPaths,
  getEmbeddedLlamaPanelState,
} from '../llm/llamaProcess.js';
import { logger, syncLoggerLevel } from '../logger.js';
import { getLlmUsageStats } from '../llm/tokenUsage.js';
import { getHardwareSnapshot } from './hardwareStats.js';
import { createAuthRouter, initAuth } from '../auth/routes.js';
import { readSessionToken } from '../auth/middleware.js';
import { getSessionByToken } from '../auth/sessions.js';
import {
  listAllowlist,
  inviteToAllowlist,
  setAllowlistStatus,
  updateAllowlistEntry,
  deleteAllowlistEntry,
  clearAllowlist,
} from '../access/telegramAllowlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const DEFAULT_GGUF_FILE = 'gemma-4-E4B-it-UD-Q8_K_XL.gguf';
const DEFAULT_GGUF_MODEL_ID = DEFAULT_GGUF_FILE.replace(/\.gguf$/i, '');
const DEFAULT_GGUF_URL = `https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/${DEFAULT_GGUF_FILE}?download=true`;

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

function maskDatabaseUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return String(url || '');
  }
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


/** Match settings → absolute path for GGUF/mmproj (relative entries are under app data / project root, not process cwd). */
function resolveStoredModelsFilePath(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (path.isAbsolute(t)) return path.normalize(t);
  return resolveUserPath(t, 'models');
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
  const hasSavedLlmModel = Boolean(
    (raw.llmModel != null && String(raw.llmModel).trim()) ||
      (raw.ollamaModel != null && String(raw.ollamaModel).trim())
  );
  const databaseUrlInput =
    raw.databaseUrl != null && String(raw.databaseUrl).trim() !== ''
      ? String(raw.databaseUrl).trim()
      : c.databaseUrlDisplay;
  const modelsDirInput =
    raw.modelsDir != null && String(raw.modelsDir).trim() !== ''
      ? String(raw.modelsDir).trim()
      : 'models';
  const engineDirInput =
    raw.engineDir != null && String(raw.engineDir).trim() !== ''
      ? String(raw.engineDir).trim()
      : 'engine';
  const mmprojPathInput =
    raw.mmprojPath != null && String(raw.mmprojPath).trim() !== '' ? String(raw.mmprojPath).trim() : '';
  const ggufPathInput =
    raw.ggufPath != null && String(raw.ggufPath).trim() !== '' ? String(raw.ggufPath).trim() : '';

  const out = {
    projectRoot,
    telegramBotTokenMasked: maskToken(c.telegramBotToken),
    telegramBotTokensMasked: effectiveTokens.map((t) => maskToken(t)).filter(Boolean),
    telegramBotCount: effectiveTokens.length,
    hasSavedToken,
    llmProvider: c.llmProvider,
    ollamaBaseUrl: c.ollamaBaseUrl,
    llamaServerUrl: c.llamaServerUrl,
    llamaServerMode: c.llamaServerMode,
    llamaServerRemote: c.llamaServerMode === 'remote',
    hasLlamaServerApiKey: Boolean(
      (raw.llamaServerApiKey != null && String(raw.llamaServerApiKey).trim()) ||
        process.env.LLAMA_SERVER_API_KEY
    ),
    llamaServerApiKeyMasked: maskToken(c.llamaServerApiKey),
    llmModel: c.llmModel,
    hasSavedLlmModel,
    ollamaModel: c.llmModel,
    guiPort: c.guiPort,
    logLevel: c.logLevel,
    browserTimeoutMs: c.browserTimeoutMs,
    maxBrowsePages: c.maxBrowsePages,
    webSearchEnabled: c.webSearchEnabled,
    databaseUrl: databaseUrlInput,
    databaseUrlResolved: maskDatabaseUrl(c.databaseUrl),
    modelsDir: c.modelsDir,
    modelsDirInput,
    ggufPath: c.ggufPath,
    ggufPathInput,
    mmprojPath: c.mmprojPath,
    mmprojPathInput,
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

function reindexBotScopedMapAfterRemoval(rawMap, removedTokenIndex) {
  const src = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const botId = Number(k);
    if (!Number.isInteger(botId) || botId < 1) continue;
    const tokenIdx = botId - 1;
    if (tokenIdx === removedTokenIndex) continue;
    const nextBotId = tokenIdx > removedTokenIndex ? botId - 1 : botId;
    out[String(nextBotId)] = v;
  }
  return out;
}

async function getTelegramBotIdentityFromToken(token, index) {
  const t = String(token || '').trim();
  if (!t) return { index, ok: false, error: 'Empty token' };
  const bot = new TelegramBot(t, { polling: false });
  try {
    const me = await bot.getMe();
    return {
      index,
      ok: true,
      id: Number(me?.id),
      username: String(me?.username || '').trim(),
      firstName: String(me?.first_name || '').trim(),
    };
  } catch (e) {
    return { index, ok: false, error: String(e?.message || 'getMe failed') };
  }
}

async function downloadDefaultGgufToModelsDir(modelsDir) {
  fs.mkdirSync(modelsDir, { recursive: true });
  const outPath = path.join(modelsDir, DEFAULT_GGUF_FILE);
  if (fs.existsSync(outPath)) {
    saveSettingsToDisk({ llmModel: DEFAULT_GGUF_MODEL_ID });
    return {
      fileName: DEFAULT_GGUF_FILE,
      modelId: DEFAULT_GGUF_MODEL_ID,
      path: outPath,
      alreadyExists: true,
    };
  }

  const tmpPath = `${outPath}.download`;
  try {
    const res = await fetch(DEFAULT_GGUF_URL);
    if (!res.ok || !res.body) {
      throw new Error(`Hugging Face download failed (HTTP ${res.status})`);
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, outPath);
    saveSettingsToDisk({ llmModel: DEFAULT_GGUF_MODEL_ID });
    return {
      fileName: DEFAULT_GGUF_FILE,
      modelId: DEFAULT_GGUF_MODEL_ID,
      path: outPath,
      sizeBytes: fs.statSync(outPath).size,
      alreadyExists: false,
    };
  } catch (e) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Express app for all `/api/*` routes (no static files — UI is served by Next.js). */
export function createApiApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '12mb' }));

  app.use('/api/auth', createAuthRouter());

  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/auth') || req.path === '/api/health') return next();
    try {
      const token = readSessionToken(req);
      req.sessionToken = token || null;
      req.session = token ? await getSessionByToken(token) : null;
      if (req.path.startsWith('/api/user/')) {
        if (req.session?.role !== 'user' || !Number.isFinite(req.session.soulUserId)) {
          res.status(401).json({ ok: false, error: 'User login required' });
          return;
        }
        return next();
      }
      if (req.session?.role !== 'admin') {
        res.status(401).json({ ok: false, error: 'Admin login required' });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/settings', (req, res) => {
    try {
      migrateLegacyLlamaServerSettings();
      res.json(readSettingsForApi());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/telegram/bot-identities', async (req, res) => {
    try {
      reloadConfig();
      const tokens = Array.isArray(getConfig().telegramBotTokens) ? getConfig().telegramBotTokens : [];
      if (!tokens.length) {
        res.json({ bots: [] });
        return;
      }
      const bots = await Promise.all(
        tokens.map((token, index) => getTelegramBotIdentityFromToken(token, index))
      );
      res.json({ bots });
    } catch (e) {
      res.status(500).json({ error: e.message, bots: [] });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const b = req.body || {};
      const prevDb = getConfig().databaseUrl;
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
      if (b.telegramBotTokenRemoveIndex !== undefined) {
        const removeIdx = Number(b.telegramBotTokenRemoveIndex);
        if (!Number.isInteger(removeIdx) || removeIdx < 0) {
          throw new Error('Invalid Telegram bot index.');
        }
        const current = Array.isArray(getConfig().telegramBotTokens) ? getConfig().telegramBotTokens : [];
        if (removeIdx >= current.length) throw new Error('Telegram bot index out of range.');
        const removedToken = current[removeIdx];
        const removedTelegramId = await resolveTelegramBotIdFromToken(removedToken);
        const nextTokens = current.filter((_, idx) => idx !== removeIdx);
        patch.telegramBotTokens = nextTokens.length ? nextTokens : null;
        patch.telegramBotToken = nextTokens[0] || null;

        const currentNames = getConfig().memoryBotNamesById || {};
        const nextNames = removeBotScopedMapKeys(currentNames, removeIdx, removedTelegramId);
        patch.memoryBotNamesById = Object.keys(nextNames).length ? nextNames : null;

        const currentPersonaByBot = getConfig().botPersonaByBotId || {};
        const nextPersonaByBot = removeBotScopedMapKeys(currentPersonaByBot, removeIdx, removedTelegramId);
        patch.botPersonaByBotId = Object.keys(nextPersonaByBot).length ? nextPersonaByBot : null;
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
      if (b.llamaServerMode === 'local' || b.llamaServerMode === 'remote') {
        patch.llamaServerMode = b.llamaServerMode;
        patch.llamaServerExternal = null;
      }
      if (typeof b.llamaServerApiKey === 'string' && b.llamaServerApiKey.trim()) {
        patch.llamaServerApiKey = b.llamaServerApiKey.trim();
      }
      if (b.llamaServerApiKeyClear === true) {
        patch.llamaServerApiKey = null;
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
      if (typeof b.databaseUrl === 'string') {
        const d = b.databaseUrl.trim();
        patch.databaseUrl = d || null;
      }
      if (typeof b.databasePath === 'string' && /^(postgres|postgresql):\/\//i.test(b.databasePath)) {
        patch.databaseUrl = b.databasePath.trim() || null;
      }
      if (typeof b.modelsDir === 'string') {
        const m = b.modelsDir.trim();
        patch.modelsDir = m || null;
      }
      if (typeof b.ggufPath === 'string') {
        const gp = b.ggufPath.trim();
        patch.ggufPath = gp || null;
      }
      if (typeof b.mmprojPath === 'string') {
        const mp = b.mmprojPath.trim();
        patch.mmprojPath = mp || null;
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
      migrateLegacyLlamaServerSettings();
      const nextDb = getConfig().databaseUrl;
      if (nextDb !== prevDb) {
        await resetDatabaseConnection();
      }
      syncLoggerLevel();
      res.json({ ok: true, settings: readSettingsForApi() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  /** Saved tokens + bot naming/persona metadata + Telegram access list. Stops bot if running. Does not edit .env. */
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
      await clearTelegramAccessRecords();
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
        llamaServerMode: c.llamaServerMode,
        llamaServerRemote: c.llmProvider === 'llama-server' ? isLlamaServerRemote(c) : false,
        spawnedByApp,
        embeddedRunning: embeddedLlmProcessRunning(),
        embeddedPanel: c.llmProvider === 'llama-server' ? getEmbeddedLlamaPanelState() : null,
        listening,
        ollamaReachable,
        online,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/llm/test-connection', async (req, res) => {
    try {
      const b = req.body || {};
      const provider = String(b.provider || '').trim().toLowerCase();
      const baseUrl = String(b.baseUrl || '').trim().replace(/\/$/, '');
      if (provider !== 'ollama' && provider !== 'llama-server') {
        res.status(400).json({ ok: false, error: 'Test connection only supports local backends.' });
        return;
      }
      if (!baseUrl) {
        res.status(400).json({ ok: false, error: 'Base URL is required.' });
        return;
      }

      if (provider === 'llama-server') {
        const authOverrides = {};
        const apiKey = String(b.llamaServerApiKey ?? b.apiKey ?? '').trim();
        if (apiKey) authOverrides.apiKey = apiKey;
        const reachable = await probeLlamaServerReachable(baseUrl, 3000, authOverrides);
        if (!reachable) {
          res.status(400).json({
            ok: false,
            provider,
            url: baseUrl,
            error: `Could not connect to llama.cpp server at ${baseUrl}.`,
          });
          return;
        }
        const listed = await fetchLlamaServerModelNames(baseUrl, authOverrides);
        res.json({
          ok: true,
          provider,
          url: baseUrl,
          modelCount: listed.models?.length ?? 0,
          message: listed.ok
            ? `Connected to llama.cpp server at ${baseUrl} (${listed.models.length} model(s) listed).`
            : `Connected to llama.cpp server at ${baseUrl}.`,
        });
        return;
      }

      const out = await fetchOllamaModelNames(baseUrl);
      if (!out.ok) {
        res.status(400).json({
          ok: false,
          provider,
          url: baseUrl,
          error: out.error || `Could not connect to Ollama at ${baseUrl}.`,
        });
        return;
      }
      res.json({
        ok: true,
        provider,
        url: baseUrl,
        modelCount: Array.isArray(out.models) ? out.models.length : 0,
        message: `Connected to Ollama at ${baseUrl}.`,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/llm/start-server', async (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      if (c.llmProvider !== 'llama-server' && c.llmProvider !== 'ollama') {
        res.status(400).json({
          ok: false,
          error: 'Set LLM backend to Ollama or llama.cpp server (Engine tab), save, then try again.',
        });
        return;
      }
      const out =
        c.llmProvider === 'ollama'
          ? await startOllamaServerIfConfigured(true)
          : await startLlamaServerIfConfigured(true);
      if (!out.ok) {
        res.status(400).json({ ok: false, error: out.error || 'Start failed' });
        return;
      }
      res.json({ ok: true, provider: c.llmProvider, skipped: out.skipped });
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

  app.get('/api/llm/embedded-logs', (req, res) => {
    try {
      res.json({ ok: true, ...getEmbeddedLlamaPanelState() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/llm/start-embedded', async (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      if (c.llmProvider !== 'llama-server') {
        res.status(400).json({
          ok: false,
          error: 'Set LLM backend to llama.cpp server on the Engine tab, save settings, then try again.',
        });
        return;
      }
      if (isLlamaServerRemote(c)) {
        res.status(400).json({
          ok: false,
          error: 'Embedded server is not used in remote mode. Set the online base URL on the Engine tab instead.',
        });
        return;
      }
      const b = req.body || {};
      const ggufPath = resolveStoredModelsFilePath(String(b.ggufPath || '').trim());
      const mmprojPathRaw = String(b.mmprojPath || '').trim();
      const mmprojPath = mmprojPathRaw ? resolveStoredModelsFilePath(mmprojPathRaw) : '';
      const ctxSize = b.ctxSize != null ? Number(b.ctxSize) : 4096;

      if (!ggufPath) {
        res.status(400).json({
          ok: false,
          error: 'Main model path is empty.',
          embeddedPanel: getEmbeddedLlamaPanelState(),
        });
        return;
      }

      let host = String(b.host || '').trim();
      let port = b.port != null ? Number(b.port) : NaN;
      if (!host || !Number.isFinite(port) || port < 1) {
        try {
          const u = new URL(String(c.llamaServerUrl || 'http://127.0.0.1:8080').replace(/\/$/, ''));
          host = u.hostname || '127.0.0.1';
          const p = u.port;
          port = Number(p || 8080);
        } catch {
          host = '127.0.0.1';
          port = 8080;
        }
      }

      const out = await startEmbeddedLlamaServerFromPaths({
        ggufPath,
        mmprojPath: mmprojPath || null,
        host,
        port,
        ctxSize,
      });
      if (!out.ok) {
        res.status(400).json({
          ok: false,
          error: out.error || 'Start failed',
          embeddedPanel: getEmbeddedLlamaPanelState(),
        });
        return;
      }
      const url = `http://${host}:${port}`.replace(/\/$/, '');
      const llmModel = path.basename(ggufPath).replace(/\.gguf$/i, '') || 'local';
      const modelsDirForGguf = path.dirname(ggufPath);
      saveSettingsToDisk({
        llmProvider: 'llama-server',
        llamaServerMode: 'local',
        llamaServerExternal: null,
        llamaServerUrl: url,
        ggufPath,
        mmprojPath: mmprojPath || '',
        llmModel,
        modelsDir: modelsDirForGguf,
      });
      res.json({
        ok: true,
        url,
        embeddedPanel: getEmbeddedLlamaPanelState(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, embeddedPanel: getEmbeddedLlamaPanelState() });
    }
  });

  app.get('/api/chat/sessions', async (req, res) => {
    try {
      await getPool();
      const sessions = await listChatSessions();
      const ids = sessions.map((s) => s.userId);
      const labels = await getTelegramLabelsForUserIds(ids);
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
      await getPool();
      const cfg = getConfig();
      const userId = Number((req.body || {}).userId);
      const text = String((req.body || {}).text ?? '').trim();
      const imageDataUrl = String((req.body || {}).imageDataUrl ?? '').trim();
      if (!text && !imageDataUrl) {
        res.status(400).json({ ok: false, error: 'Message text or image is required.' });
        return;
      }
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      const userPreview = text || '[image]';
      await appendChatMessage(userId, 'user', userPreview);
      const startedAt = Date.now();
      try {
        const out = imageDataUrl
          ? await handleImageMessage(userId, text, imageDataUrl)
          : await handleTextMessage(userId, text);
        await appendChatMessage(userId, 'assistant', out.reply);
        scheduleMemorySummaryRefresh(userId);
        const elapsedMs = Date.now() - startedAt;
        res.json({
          ok: true,
          reply: out.reply,
          wantConfirmKeyboard: Boolean(out.wantConfirmKeyboard),
          meta: {
            elapsedMs,
            provider: String(cfg.llmProvider || '').trim() || 'unknown',
            model: String(cfg.llmModel || '').trim() || 'unknown',
          },
        });
      } catch (e) {
        const errText = `Error: ${e.message}`;
        await appendChatMessage(userId, 'assistant', errText);
        res.status(500).json({ ok: false, error: e.message });
      }
    } catch (e) {
      logger.error(`GUI chat send: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/chat', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const userId = req.query.userId != null && req.query.userId !== '' ? Number(req.query.userId) : null;
      const rows = await listChatMessages({
        userId: Number.isFinite(userId) ? userId : null,
        limit,
      });
      const userIds = await listChatUserIds();
      res.json({ messages: rows, userIds, guiConsoleUserId: GUI_CONSOLE_USER_ID });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chat/clear-session', async (req, res) => {
    try {
      await getPool();
      const userId = Number((req.body || {}).userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      const deleted = await clearChatMessagesForUser(userId);
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

  app.post('/api/models/download-default', async (req, res) => {
    try {
      reloadConfig();
      const c = getConfig();
      const result = await downloadDefaultGgufToModelsDir(c.modelsDir);
      res.json({ ok: true, ...result, settings: readSettingsForApi() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/llm/catalog', async (req, res) => {
    try {
      reloadConfig();
      const q = req.query || {};
      const override = normalizeCatalogLlmProvider(q.llmProvider);
      const catalogOpts = {};
      if (override) catalogOpts.llmProvider = override;
      if (q.llamaServerUrl != null && String(q.llamaServerUrl).trim()) {
        catalogOpts.llamaServerUrl = String(q.llamaServerUrl).trim();
      }
      if (q.llamaServerMode === 'local' || q.llamaServerMode === 'remote') {
        catalogOpts.llamaServerMode = q.llamaServerMode;
      }
      if (q.llamaServerApiKey != null && String(q.llamaServerApiKey).trim()) {
        catalogOpts.llamaServerApiKey = String(q.llamaServerApiKey).trim();
      }
      const catalog = await buildModelCatalog(catalogOpts);
      res.json(catalog);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/summary', async (req, res) => {
    try {
      await getPool();
      const chatCount = (await query('SELECT COUNT(*)::int AS c FROM chat_log')).rows[0].c;
      const eventsCount = (await query('SELECT COUNT(*)::int AS c FROM events')).rows[0].c;
      let recordsCount = 0;
      try {
        recordsCount = (await query('SELECT COUNT(*)::int AS c FROM user_records')).rows[0].c;
      } catch {
        /* table missing before migrate */
      }
      const soulsCount = (await query('SELECT COUNT(*)::int AS c FROM soul')).rows[0].c;
      const pendingCount = (await query('SELECT COUNT(*)::int AS c FROM pending_confirm')).rows[0].c;
      let accessPending = 0;
      try {
        accessPending = (
          await query(`SELECT COUNT(*)::int AS c FROM telegram_users WHERE status = 'pending'`)
        ).rows[0].c;
      } catch {
        /* table missing before migrate */
      }
      res.json({ chatCount, eventsCount, recordsCount, soulsCount, pendingCount, accessPending });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/stats/llm-usage', async (req, res) => {
    try {
      await getPool();
      const provider = String(req.query?.provider || '').trim().toLowerCase();
      const providerFilter = provider || null;
      res.json(await getLlmUsageStats(providerFilter));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/access/users', async (req, res) => {
    try {
      reloadConfig();
      await getPool();
      const status = req.query.status || null;
      const rows = await listTelegramUsers(status);
      res.json({ users: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/access/set', async (req, res) => {
    try {
      const b = req.body || {};
      const userId = Number(b.userId);
      const status = String(b.status || '').toLowerCase();
      const hasUsername = Object.prototype.hasOwnProperty.call(b, 'username');
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Invalid userId' });
        return;
      }
      if (status) {
        res.status(400).json({
          ok: false,
          error:
            'Legacy access status is disabled. Use Settings → Access to invite or disable users on the allowlist.',
        });
        return;
      }
      if (!hasUsername) {
        res.status(400).json({ ok: false, error: 'No updates provided' });
        return;
      }
      await getPool();
      await setTelegramUserName(userId, b.username);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/access/clear-all', async (req, res) => {
    try {
      await getPool();
      await clearTelegramAccessRecords();
      res.json({
        ok: true,
        note: 'Cleared legacy telegram_users records only. To clear invites, use Access → Clear all on the allowlist.',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/memory/sessions', async (req, res) => {
    try {
      await getPool();
      const botId = req.query.botId != null && req.query.botId !== '' ? Number(req.query.botId) : null;
      const scopedR = Number.isFinite(botId)
        ? await query('SELECT id FROM telegram_identity_map WHERE bot_id = $1', [botId])
        : { rows: [] };
      const scopedRows = scopedR.rows;
      const scopedSet = new Set(
        scopedRows.map((r) => SCOPED_USER_ID_OFFSET + Number(r.id)).filter((n) => Number.isFinite(n))
      );
      const chatIds = await listChatUserIds();
      const fromChat = Number.isFinite(botId)
        ? chatIds.filter((id) => scopedSet.has(Number(id)))
        : chatIds;
      const soulRows = await listSouls(Number.isFinite(botId) ? { botId } : {});
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
      const labels = await getTelegramLabelsForUserIds(ids);
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

  app.get('/api/soul/:userId', async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      await getPool();
      res.json(await getSoul(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/soul/:userId', async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      const b = req.body || {};
      await getPool();
      await setSoulContent(userId, {
        display_name: b.display_name,
        profile: b.profile,
        botPersona: b.botPersona,
      });
      res.json({ ok: true, soul: await getSoul(userId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/:userId/clear', async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }
      await getPool();
      await clearSoul(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/copy', async (req, res) => {
    try {
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
        res.status(400).json({ ok: false, error: 'fromUserId and toUserId must be numbers' });
        return;
      }
      await getPool();
      await copySoulFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: await getSoul(toUserId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/soul/copy-bot-persona', async (req, res) => {
    try {
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
        res.status(400).json({ ok: false, error: 'fromUserId and toUserId must be numbers' });
        return;
      }
      await getPool();
      await copyBotPersonaFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: await getSoul(toUserId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/memory/clear-all', async (req, res) => {
    try {
      const confirm = String((req.body || {}).confirm || '').trim();
      if (confirm !== 'DELETE ALL') {
        res.status(400).json({
          ok: false,
          error: 'Refused. Send JSON body: { "confirm": "DELETE ALL" }',
        });
        return;
      }
      await getPool();
      await clearAllStoredMemory();
      logger.warn('clear-all-memory: wiped pending_confirm, chat_log, soul (events & user_records CASCADE)');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/data/souls', async (req, res) => {
    try {
      const botId = req.query.botId != null && req.query.botId !== '' ? Number(req.query.botId) : null;
      const rows = await listSouls(Number.isFinite(botId) ? { botId } : {});
      res.json({ souls: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory/bots', async (req, res) => {
    try {
      await getPool();
      const bots = await listConfiguredTelegramBots();
      res.json({ bots });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/calendar', async (req, res) => {
    try {
      const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 400));
      const rows = await listAllEvents(limit);
      res.json({ events: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data/pending', async (req, res) => {
    try {
      const rows = await listAllPending();
      res.json({ pending: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/data/calendar/delete', async (req, res) => {
    try {
      await getPool();
      const id = Number((req.body || {}).id);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ ok: false, error: 'Valid event id is required.' });
        return;
      }
      const ok = await deleteEventById(id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'No event with that id.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/data/records', async (req, res) => {
    try {
      await getPool();
      const userId = Number(req.query.userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: 'Query userId is required.' });
        return;
      }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const rt = String(req.query.recordType || '').toLowerCase();
      const filter = rt === 'purchase' || rt === 'medicine' ? rt : null;
      const rows = await listUserRecords(userId, { limit, record_type: filter });
      res.json({ records: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/data/records/delete', async (req, res) => {
    try {
      await getPool();
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
      const ok = await deleteUserRecordById(userId, id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'No record with that id for this user.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/data/pending/delete', async (req, res) => {
    try {
      await getPool();
      const userId = Number((req.body || {}).userId);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ ok: false, error: 'Valid userId is required.' });
        return;
      }
      await clearPending(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, cwd: projectRoot });
  });

  app.get('/api/admin/allowlist', async (req, res) => {
    try {
      await getPool();
      const rows = await listAllowlist();
      res.json({ users: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/allowlist', async (req, res) => {
    try {
      await getPool();
      const b = req.body || {};
      const row = await inviteToAllowlist({
        username: b.username,
        telegramUserId: b.telegramUserId,
        email: b.email,
        notes: b.notes,
      });
      res.json({ ok: true, user: row });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/admin/allowlist/:id', async (req, res) => {
    try {
      await getPool();
      const id = Number(req.params.id);
      const b = req.body || {};
      if (b.status) await setAllowlistStatus(id, String(b.status).toLowerCase());
      await updateAllowlistEntry(id, {
        username: b.username,
        notes: b.notes,
        telegramUserId: b.telegramUserId,
        email: b.email,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/admin/allowlist/:id', async (req, res) => {
    try {
      await getPool();
      await deleteAllowlistEntry(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/allowlist/clear-all', async (req, res) => {
    try {
      await getPool();
      await clearAllowlist();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/user/chat', async (req, res) => {
    try {
      await getPool();
      const userId = req.session.soulUserId;
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const rows = await listChatMessages({ userId, limit });
      res.json({ messages: rows, userId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/user/chat/send', async (req, res) => {
    try {
      reloadConfig();
      await getPool();
      const cfg = getConfig();
      const userId = req.session.soulUserId;
      const text = String((req.body || {}).text ?? '').trim();
      const imageDataUrl = String((req.body || {}).imageDataUrl ?? '').trim();
      if (!text && !imageDataUrl) {
        res.status(400).json({ ok: false, error: 'Message text or image is required.' });
        return;
      }
      const userPreview = text || '[image]';
      await appendChatMessage(userId, 'user', userPreview);
      const startedAt = Date.now();
      try {
        const out = imageDataUrl
          ? await handleImageMessage(userId, text, imageDataUrl)
          : await handleTextMessage(userId, text);
        await appendChatMessage(userId, 'assistant', out.reply);
        scheduleMemorySummaryRefresh(userId);
        res.json({
          ok: true,
          reply: out.reply,
          meta: {
            elapsedMs: Date.now() - startedAt,
            provider: String(cfg.llmProvider || '').trim() || 'unknown',
            model: String(cfg.llmModel || '').trim() || 'unknown',
          },
        });
      } catch (e) {
        const errText = `Error: ${e.message}`;
        await appendChatMessage(userId, 'assistant', errText);
        res.status(500).json({ ok: false, error: e.message });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return app;
}

/** @deprecated Use createApiApp — kept for imports that expect the old name. */
export function createGuiApp() {
  return createApiApp();
}

export async function startGuiServer(port) {
  await getPool();
  await initAuth();
  const app = createApiApp();
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
