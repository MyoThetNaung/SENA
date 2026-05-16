/** @param {string|null|undefined} raw @username, t.me/…, or telegram.me/… */
export function normalizeTelegramHandle(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/^@+/, '');
  const urlMatch = s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const user = s.split(/[/?#]/)[0].trim();
  return /^[A-Za-z0-9_]{4,32}$/.test(user) ? user.toLowerCase() : null;
}

/** @param {string|null|undefined} raw */
export function buildTelegramProfileUrl(raw) {
  const username = normalizeTelegramHandle(raw);
  return username ? `https://t.me/${username}` : null;
}
