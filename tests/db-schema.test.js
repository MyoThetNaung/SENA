import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;
let dbPath;
let db;

function createTestDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sena-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
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
    CREATE TABLE IF NOT EXISTS telegram_users (
      user_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      username TEXT,
      first_name TEXT,
      first_message_preview TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  `);
  return db;
}

beforeEach(() => {
  if (db) {
    db.close();
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('Database schema', () => {
  it('creates all required tables', () => {
    const testDb = createTestDb();
    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toContain('soul');
    expect(tables).toContain('events');
    expect(tables).toContain('pending_confirm');
    expect(tables).toContain('chat_log');
    expect(tables).toContain('telegram_users');
    expect(tables).toContain('llm_usage');
  });

  it('sets WAL journal mode', () => {
    const testDb = createTestDb();
    const row = testDb.pragma('journal_mode').get();
    expect(row.journal_mode).toBe('wal');
  });

  it('sets busy_timeout', () => {
    const testDb = createTestDb();
    const row = testDb.pragma('busy_timeout').get();
    expect(row.timeout).toBe(5000);
  });
});

describe('Soul table operations', () => {
  it('inserts and retrieves a soul record', () => {
    const testDb = createTestDb();
    testDb.prepare('INSERT INTO soul (user_id, display_name) VALUES (?, ?)').run(123, 'Alice');
    const row = testDb.prepare('SELECT * FROM soul WHERE user_id = ?').get(123);
    expect(row.display_name).toBe('Alice');
    expect(row.user_id).toBe(123);
  });

  it('defaults preferences to empty object and facts to empty array', () => {
    const testDb = createTestDb();
    testDb.prepare('INSERT INTO soul (user_id) VALUES (?)').run(456);
    const row = testDb.prepare('SELECT * FROM soul WHERE user_id = ?').get(456);
    expect(JSON.parse(row.preferences)).toEqual({});
    expect(JSON.parse(row.facts)).toEqual([]);
  });
});

describe('Event operations', () => {
  it('inserts and retrieves events for a user', () => {
    const testDb = createTestDb();
    testDb.prepare('INSERT INTO soul (user_id) VALUES (?)').run(1);
    testDb
      .prepare('INSERT INTO events (user_id, starts_at, title) VALUES (?, ?, ?)')
      .run(1, '2026-01-01T09:00:00.000Z', 'New Year Meeting');
    const rows = testDb.prepare('SELECT * FROM events WHERE user_id = ?').all(1);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('New Year Meeting');
  });
});

describe('Pending confirmations', () => {
  it('upserts a pending confirmation', () => {
    const testDb = createTestDb();
    testDb
      .prepare('INSERT INTO pending_confirm (user_id, kind, payload) VALUES (?, ?, ?)')
      .run(1, 'web_search', '{"query":"test"}');
    let row = testDb.prepare('SELECT * FROM pending_confirm WHERE user_id = ?').get(1);
    expect(row.kind).toBe('web_search');
    expect(JSON.parse(row.payload)).toEqual({ query: 'test' });

    testDb
      .prepare(
        `INSERT INTO pending_confirm (user_id, kind, payload) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload`
      )
      .run(1, 'add_event', '{"title":"meeting"}');
    row = testDb.prepare('SELECT * FROM pending_confirm WHERE user_id = ?').get(1);
    expect(row.kind).toBe('add_event');
  });
});