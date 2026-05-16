import { sqliteUtcStringToIsoZ } from './sqliteUtc.js';

/** Normalize DB timestamp (PG returns Date; legacy rows may be strings) to ISO Z. */
export function rowTimestampToIsoZ(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return sqliteUtcStringToIsoZ(value);
}
