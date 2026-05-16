/** @param {string|null|undefined} raw IANA timezone id */
export function normalizeTimezone(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s });
    return s;
  } catch {
    return null;
  }
}

/** Browser/Node: common IANA zones for dropdowns (sorted). */
export function listCommonTimezones() {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone').slice().sort();
    } catch {
      /* fall through */
    }
  }
  return [
    'UTC',
    'Asia/Yangon',
    'Asia/Bangkok',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

export function formatTimezoneLabel(tz) {
  const id = normalizeTimezone(tz);
  if (!id) return '';
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const off = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    return off ? `${id} (${off})` : id;
  } catch {
    return id;
  }
}
