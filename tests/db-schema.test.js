import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'schema', 'postgres.sql');

describe('PostgreSQL schema file', () => {
  it('exists and defines core tables', () => {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS soul');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pending_confirm');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS chat_log');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS telegram_users');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS telegram_identity_map');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS llm_usage');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_records');
  });
});
