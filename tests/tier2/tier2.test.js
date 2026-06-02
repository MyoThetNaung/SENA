import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson } from '../../src/connectors/crypto.js';
import { extractTextFromUpload } from '../../src/rag/textUpload.js';
import { localDateHour } from '../../src/assistant/preferences.js';

describe('connectors crypto', () => {
  it('round-trips JSON credentials', () => {
    const obj = { baseUrl: 'https://x.atlassian.net', email: 'a@b.com', apiToken: 'secret' };
    const enc = encryptJson(obj);
    expect(decryptJson(enc)).toEqual(obj);
  });
});

describe('text upload', () => {
  it('extracts UTF-8 from base64 file', () => {
    const text = 'Hello notes';
    const fileBase64 = Buffer.from(text, 'utf8').toString('base64');
    const out = extractTextFromUpload({ fileName: 'notes.md', fileBase64 });
    expect(out.text).toBe(text);
    expect(out.title).toBe('notes');
  });

  it('rejects unsupported extensions', () => {
    expect(() =>
      extractTextFromUpload({
        fileName: 'doc.pdf',
        fileBase64: Buffer.from('x').toString('base64'),
      }),
    ).toThrow(/Supported file types/);
  });
});

describe('localDateHour', () => {
  it('returns ymd and hour for timezone', () => {
    const d = new Date('2026-06-03T01:30:00.000Z');
    const { ymd, hour } = localDateHour(d, 'UTC');
    expect(ymd).toBe('2026-06-03');
    expect(hour).toBe(1);
  });
});
