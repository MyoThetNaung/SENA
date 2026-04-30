import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

function getRuntimeRoot() {
  const isElectron = Boolean(process.versions?.electron);
  if (!isElectron) return projectRoot;

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }

  return path.join(process.env.APPDATA || os.homedir(), 'SENA');
}

const runtimeRoot = getRuntimeRoot();
const SETTINGS_PATH = path.join(runtimeRoot, 'data', 'settings.json');

function webSearchFromSettings(settings) {
  const ws = settings.webSearchEnabled;
  if (ws === true) return true;
  if (ws === false) return false;
  return String(process.env.WEB_SEARCH ?? '').trim() === '1';
}

function readSettingsFile() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function isValidTelegramBotToken(raw) {
  const t = String(raw ?? '').trim();
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(t);
}

const defaultDb = path.join(runtimeRoot, 'data', 'assistant.db');

function resolveUserPath(p, defaultRelative) {
  const raw = (p != null && String(p).trim() !== '' ? String(p).trim() : defaultRelative) || defaultRelative;
  if (path.isAbsolute(raw)) return raw;
  return path.join(runtimeRoot, raw);
}

function buildConfig() {
  const settings = readSettingsFile();
  const envToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const settingsToken = String(settings.telegramBotToken ?? '').trim();
  const settingsTokens = Array.isArray(settings.telegramBotTokens)
    ? settings.telegramBotTokens
        .map((t) => String(t ?? '').trim())
        .filter((t) => isValidTelegramBotToken(t))
    : [];
  const telegramBotTokens = settingsTokens.length
    ? [...new Set(settingsTokens)]
    : isValidTelegramBotToken(settingsToken)
      ? [settingsToken]
      : isValidTelegramBotToken(envToken)
        ? [envToken]
        : [];
  const telegramBotToken = telegramBotTokens[0] || '';
  const ollamaBaseUrl = String(
    settings.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  const llamaServerUrl = String(
    settings.llamaServerUrl ?? process.env.LLAMA_SERVER_URL ?? 'http://127.0.0.1:8080'
  ).replace(/\/$/, '');
  const llmProviderRaw = String(
    settings.llmProvider ?? process.env.LLM_PROVIDER ?? 'llama-server'
  ).toLowerCase();
  let llmProvider = 'llama-server';
  if (llmProviderRaw === 'ollama') llmProvider = 'ollama';
  else if (llmProviderRaw === 'openai') llmProvider = 'openai';
  else if (llmProviderRaw === 'openrouter') llmProvider = 'openrouter';
  else if (llmProviderRaw === 'gemini' || llmProviderRaw === 'google') llmProvider = 'gemini';
  else if (llmProviderRaw === 'llama-server' || llmProviderRaw === 'llamacpp') llmProvider = 'llama-server';
  const openaiApiKey = String(
    settings.openaiApiKey ?? process.env.OPENAI_API_KEY ?? ''
  ).trim();
  const geminiApiKey = String(
    settings.geminiApiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ''
  ).trim();
  const openrouterApiKey = String(
    settings.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ''
  ).trim();
  const openrouterBaseUrl = String(
    settings.openrouterBaseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '');
  const llmModel = String(
    settings.llmModel ?? settings.ollamaModel ?? process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3.2'
  );
  const engineDir = resolveUserPath(settings.engineDir, 'engine');
  const settingsDb =
    settings.databasePath != null && String(settings.databasePath).trim() !== ''
      ? String(settings.databasePath).trim()
      : null;
  const envDb = process.env.DATABASE_PATH ? String(process.env.DATABASE_PATH).trim() : null;
  const databasePath = settingsDb
    ? resolveUserPath(settingsDb, 'data/assistant.db')
    : envDb
      ? resolveUserPath(envDb, 'data/assistant.db')
      : defaultDb;
  const databasePathDisplay = settingsDb || envDb || 'data/assistant.db';
  const modelsDir = resolveUserPath(settings.modelsDir, 'models');
  const logLevel = String(settings.logLevel ?? process.env.LOG_LEVEL ?? 'info');
  const browserTimeoutMs = Math.min(
    60000,
    Math.max(1000, Number(settings.browserTimeoutMs ?? process.env.BROWSER_TIMEOUT_MS) || 10000)
  );
  const maxBrowsePages = Math.min(
    2,
    Math.max(1, Number(settings.maxBrowsePages ?? process.env.MAX_BROWSE_PAGES) || 2)
  );
  const webSearchEnabled = webSearchFromSettings(settings);
  const guiPort = Math.min(
    65535,
    Math.max(1024, Number(settings.guiPort ?? process.env.GUI_PORT) || 3847)
  );
  const openBrowserGui =
    settings.openBrowser === false
      ? false
      : settings.openBrowser === true
        ? true
        : process.env.OPEN_BROWSER !== '0';
  const autoStartLlamaServer =
    settings.autoStartLlamaServer === true || process.env.AUTO_START_LLAMA_SERVER === '1';

  const rawPersona = settings.botPersona && typeof settings.botPersona === 'object' ? settings.botPersona : {};
  const rawPersonaByBotId =
    settings.botPersonaByBotId && typeof settings.botPersonaByBotId === 'object'
      ? settings.botPersonaByBotId
      : {};
  const rawMemoryBotNamesById =
    settings.memoryBotNamesById && typeof settings.memoryBotNamesById === 'object'
      ? settings.memoryBotNamesById
      : {};
  const botPersona = {
    displayName: String(rawPersona.displayName ?? '').trim(),
    displayNameMy: String(rawPersona.displayNameMy ?? '').trim(),
    gender: String(rawPersona.gender ?? '').trim(),
    style: String(rawPersona.style ?? '').trim(),
    role: String(rawPersona.role ?? '').trim(),
    addressUserEn: String(rawPersona.addressUserEn ?? '').trim(),
    addressUserMy: String(rawPersona.addressUserMy ?? '').trim(),
  };
  const botPersonaByBotId = {};
  for (const [k, v] of Object.entries(rawPersonaByBotId)) {
    if (!/^\d+$/.test(String(k))) continue;
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    botPersonaByBotId[String(k)] = {
      displayName: String(o.displayName ?? '').trim(),
      displayNameMy: String(o.displayNameMy ?? '').trim(),
      gender: String(o.gender ?? '').trim(),
      style: String(o.style ?? '').trim(),
      role: String(o.role ?? '').trim(),
      addressUserEn: String(o.addressUserEn ?? '').trim(),
      addressUserMy: String(o.addressUserMy ?? '').trim(),
    };
  }
  const memoryBotNamesById = {};
  for (const [k, v] of Object.entries(rawMemoryBotNamesById)) {
    if (!/^\d+$/.test(String(k))) continue;
    const name = String(v ?? '').trim();
    if (name) memoryBotNamesById[String(k)] = name;
  }

  return {
    telegramBotToken,
    telegramBotTokens,
    ollamaBaseUrl,
    llamaServerUrl,
    llmProvider,
    openaiApiKey,
    geminiApiKey,
    openrouterApiKey,
    openrouterBaseUrl,
    llmModel,
    /** @deprecated use llmModel */
    ollamaModel: llmModel,
    engineDir,
    databasePath,
    databasePathDisplay,
    logLevel,
    browserTimeoutMs,
    maxBrowsePages,
    webSearchEnabled,
    guiPort,
    modelsDir,
    openBrowserGui,
    autoStartLlamaServer,
    botPersona,
    botPersonaByBotId,
    memoryBotNamesById,
  };
}

let cached = null;

/** Full config (env + data/settings.json). Safe to call without a token for the GUI. */
export function getConfig() {
  if (!cached) cached = buildConfig();
  return cached;
}

export function reloadConfig() {
  cached = buildConfig();
  return cached;
}

export function getSettingsPath() {
  return SETTINGS_PATH;
}

export function saveSettingsToDisk(partial) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  const prev = readSettingsFile();
  const next = { ...prev, ...partial };
  for (const [k, v] of Object.entries(partial)) {
    if (v === null || v === undefined) delete next[k];
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  reloadConfig();
}

/** Required before starting the Telegram bot (CLI or GUI). */
export function assertBotConfigReady() {
  const c = getConfig();
  if (!Array.isArray(c.telegramBotTokens) || !c.telegramBotTokens.length) {
    throw new Error(
      'Telegram bot token is missing. Add one or more bot tokens in the Control Panel (npm run gui) or set TELEGRAM_BOT_TOKEN in .env.'
    );
  }
}
