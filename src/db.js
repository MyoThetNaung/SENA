import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getConfig } from './config.js';
import { logger } from './logger.js';

let dbInstance = null;
let lastDbPath = null;

export function resetDatabaseConnection() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
    dbInstance = null;
    lastDbPath = null;
  }
}

export function getDb() {
  const { databasePath } = getConfig();
  if (dbInstance && lastDbPath === databasePath) return dbInstance;
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
    dbInstance = null;
  }
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  dbInstance = db;
  lastDbPath = databasePath;
  logger.info(`SQLite ready at ${databasePath}`);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT,
      preferences TEXT NOT NULL DEFAULT '{}',
      facts TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES soul(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_starts ON events(user_id, starts_at);

    CREATE TABLE IF NOT EXISTS pending_confirm (
      user_id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_log_user ON chat_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_log_id ON chat_log(id);

    CREATE TABLE IF NOT EXISTS telegram_users (
      user_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      username TEXT,
      first_name TEXT,
      first_message_preview TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_users_status ON telegram_users(status);
    CREATE TABLE IF NOT EXISTS telegram_identity_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(bot_id, telegram_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_identity_bot_user ON telegram_identity_map(bot_id, telegram_user_id);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_day ON llm_usage(day_key);
  `);
  seedTelegramUsersFromSoul(db);
}

function seedTelegramUsersFromSoul(db) {
  try {
    const souls = db.prepare('SELECT user_id FROM soul').all();
    const ins = db.prepare(
      `INSERT OR IGNORE INTO telegram_users (user_id, status, last_seen, created_at)
       VALUES (?, 'approved', datetime('now'), datetime('now'))`
    );
    for (const { user_id } of souls) {
      ins.run(user_id);
    }
  } catch {
    /* ignore */
  }
}
