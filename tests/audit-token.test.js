import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AUDIT_EVENT_TYPES, resolveAuditEventType, shouldAuditRequest } from '../src/audit/auditLog.js';
import { monthKey, localDayKey } from '../src/llm/tokenUsage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'schema', 'postgres.sql');

describe('audit log', () => {
  it('schema defines audit_logs table', () => {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
    expect(sql).toContain('event_type TEXT NOT NULL');
  });

  it('exports known event types', () => {
    expect(AUDIT_EVENT_TYPES).toContain('auth.admin_login');
    expect(AUDIT_EVENT_TYPES).toContain('user.chat_send');
  });

  it('resolves settings update event', () => {
    const req = { method: 'POST', path: '/api/settings' };
    expect(resolveAuditEventType(req)).toBe('settings.update');
    expect(shouldAuditRequest(req)).toBe(true);
  });

  it('skips health checks', () => {
    const req = { method: 'GET', path: '/api/health' };
    expect(shouldAuditRequest(req)).toBe(false);
  });
});

describe('token usage keys', () => {
  it('monthKey is YYYY-MM', () => {
    const mk = monthKey(new Date('2026-05-17T12:00:00'));
    expect(mk).toMatch(/^\d{4}-\d{2}$/);
    expect(mk).toBe('2026-05');
  });

  it('localDayKey is YYYY-MM-DD', () => {
    const dk = localDayKey(new Date('2026-05-17T12:00:00'));
    expect(dk).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('schema adds soul_user_id and month_key to llm_usage', () => {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    expect(sql).toContain('soul_user_id BIGINT');
    expect(sql).toContain('month_key TEXT');
  });
});
