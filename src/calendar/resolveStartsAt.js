/**
 * Calendar event time resolution using the machine clock (Node runs on the user's PC for local installs).
 * The LLM often lacks "today"; we inject context and fall back when ISO is missing/invalid.
 */

/** Short labels for prompts + debugging. */
export function getCalendarClockContext() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const localLong = now.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  return {
    iso: now.toISOString(),
    localLong,
    tz,
    localDateYmd: ymd,
  };
}

/**
 * Parse times like "at 3pm", "at 15:30", "3 pm" from user text (avoids false matches from log timestamps).
 * Returns { h, m } 24h local, or null.
 */
export function parseTimeFromMessage(msg) {
  const s = String(msg || '');
  let m = s.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] != null ? parseInt(m[2], 10) : 0;
    const ap = m[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (min > 59 || h > 23) return null;
    return { h, m: min };
  }
  m = s.match(/\b(?:at|@)\s*(\d{1,2}):(\d{2})\b/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h <= 23 && min <= 59) return { h, m: min };
  }
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) {
    let h = parseInt(m[1], 10);
    if (h > 12) return null;
    if (m[2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[2].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m: 0 };
  }
  return null;
}

function applyLocalTime(d, time) {
  if (!time) {
    d.setHours(9, 0, 0, 0);
    return;
  }
  d.setHours(time.h, time.m, 0, 0);
}

/**
 * Prefer model ISO when valid; otherwise interpret relative phrases using PC local time.
 */
export function resolveEventStartsAt(modelStartsAt, userMessage) {
  const raw = String(modelStartsAt || '').trim();
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  const msg = String(userMessage || '');
  const now = new Date();
  const time = parseTimeFromMessage(msg);

  if (/\btomorrow\b/i.test(msg)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
    applyLocalTime(d, time ?? { h: 9, m: 0 });
    return d.toISOString();
  }

  if (/\btoday\b/i.test(msg)) {
    const d = new Date(now);
    if (time) applyLocalTime(d, time);
    else {
      d.setHours(9, 0, 0, 0);
    }
    if (d.getTime() <= now.getTime()) {
      d.setTime(now.getTime() + 60 * 60 * 1000);
    }
    return d.toISOString();
  }

  if (/\btonight\b/i.test(msg)) {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setHours(now.getHours() + 1, now.getMinutes(), 0, 0);
    }
    if (time) applyLocalTime(d, time);
    return d.toISOString();
  }

  return null;
}
