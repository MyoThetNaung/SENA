import { describe, it, expect } from 'vitest';
import { normalizeTimezone, listCommonTimezones } from '../src/util/timezone.js';
import { getCalendarClockContext } from '../src/calendar/resolveStartsAt.js';

describe('normalizeTimezone', () => {
  it('accepts valid IANA ids', () => {
    expect(normalizeTimezone('Asia/Yangon')).toBe('Asia/Yangon');
  });

  it('rejects invalid ids', () => {
    expect(normalizeTimezone('Not/A/Zone')).toBeNull();
  });
});

describe('getCalendarClockContext', () => {
  it('uses provided timezone for local date', () => {
    const ck = getCalendarClockContext({ timezone: 'UTC' });
    expect(ck.tz).toBe('UTC');
    expect(ck.localDateYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('listCommonTimezones', () => {
  it('returns a non-empty list', () => {
    expect(listCommonTimezones().length).toBeGreaterThan(0);
  });
});
