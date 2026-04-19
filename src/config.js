import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

const SETTINGS_PATH = path.join(projectRoot, 'data', 'settings.json');

function readSettingsFile() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function parseUserIds(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`Invalid user id in ALLOWED_USER_IDS: ${s}`);
      return n;
    });
}

const defaultDb = path.join(projectRoot, 'data', 'assistant.db');

function resolveUserPath(p, defaultRelative) {
  const raw = (p != null && String(p).trim() !== '' ? String(p).trim() : defaultRelative) || defaultRelative;
  if (path.isAbsolute(raw)) return raw;
  return path.join(projectRoot, raw);
}

function buildConfig() {
  const settings = readSettingsFile();
  const telegramBotToken = String(
    settings.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN ?? ''
  ).trim();
  const allowedUserIds = parseUserIds(settings.allowedUserIds ?? process.env.ALLOWED_USER_IDS ?? '');
  const ollamaBaseUrl = String(
    settings.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  const llamaServerUrl = String(
    settings.llamaServerUrl ?? process.env.LLAMA_SERVER_URL ?? 'http://127.0.0.1:8080'
  ).replace(/\/$/, '');
  const llmProviderRaw = String(
    settings.llmProvider ?? process.env.LLM_PROVIDER ?? 'llama-server'
  ).toLowerCase();
  const llmProvider = llmProviderRaw === 'llama-server' || llmProviderRaw === 'llamacpp' ? 'llama-server' : 'ollama';
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
  const botPersona = {
    displayName: String(rawPersona.displayName ?? '').trim(),
    gender: String(rawPersona.gender ?? '').trim(),
    style: String(rawPersona.style ?? '').trim(),
    role: String(rawPersona.role ?? '').trim(),
    addressUserEn: String(rawPersona.addressUserEn ?? '').trim(),
    addressUserMy: String(rawPersona.addressUserMy ?? '').trim(),
  };

  return {
    telegramBotToken,
    allowedUserIds,
    ollamaBaseUrl,
    llamaServerUrl,
    llmProvider,
    llmModel,
    /** @deprecated use llmModel */
    ollamaModel: llmModel,
    engineDir,
    databasePath,
    databasePathDisplay,
    logLevel,
    browserTimeoutMs,
    maxBrowsePages,
    guiPort,
    modelsDir,
    openBrowserGui,
    autoStartLlamaServer,
    botPersona,
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
  if (!c.telegramBotToken) {
    throw new Error(
      'Telegram bot token is missing. Enter it in the Control Panel (npm run gui) or set TELEGRAM_BOT_TOKEN in .env.'
    );
  }
}
