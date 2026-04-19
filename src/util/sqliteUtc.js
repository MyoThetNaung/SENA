/**
 * SQLite date/time functions return UTC strings without a timezone suffix.
 * ECMAScript parses "YYYY-MM-DD HH:MM:SS" as *local* time, so chat timestamps
 * drift from the system clock. Normalize to ISO 8601 with Z for correct UTC
 * parsing; callers can use toLocaleString() for local display.
 */
export function sqliteUtcStringToIsoZ(sqliteDatetime) {
  const s = String(sqliteDatetime ?? '').trim();
  if (!s) return s;
  if (/[zZ]$/.test(s)) return s;
  if (/[+-]\d{2}:?\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,9}))?$/);
  if (!m) return s;
  const frac = m[3] ? `.${String(m[3]).padEnd(3, '0').slice(0, 3)}` : '';
  return `${m[1]}T${m[2]}${frac}Z`;
}
