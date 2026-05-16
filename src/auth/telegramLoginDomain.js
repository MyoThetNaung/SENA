import { getConfig } from '../config.js';

/**
 * Hostname to register in @BotFather → /setdomain for the Login Widget.
 * Must match the browser hostname (not port). Override when behind a reverse proxy.
 * @param {import('express').Request} [req]
 */
export function resolveTelegramWidgetDomain(req) {
  const fromSettings = String(getConfig().telegramLoginDomain ?? '').trim();
  const fromEnv = String(process.env.TELEGRAM_LOGIN_DOMAIN ?? '').trim();
  const override = fromSettings || fromEnv;
  if (override) {
    return normalizeTelegramWidgetDomain(override);
  }
  const rawHost =
    (req && (req.get('x-forwarded-host') || req.get('host'))) ||
    req?.headers?.host ||
    '';
  const host = String(rawHost).split(',')[0].trim();
  if (!host) return 'localhost';
  const hostname = host.split(':')[0].trim().toLowerCase();
  return hostname || 'localhost';
}

/** Strip scheme/path/port — BotFather wants hostname only (e.g. example.com or localhost). */
export function normalizeTelegramWidgetDomain(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'localhost';
  s = s.replace(/^https?:\/\//, '');
  s = s.split('/')[0].split(':')[0].trim();
  return s || 'localhost';
}

/**
 * @param {import('express').Request} [req]
 */
export function buildTelegramLoginWidgetHints(req) {
  const widgetDomain = resolveTelegramWidgetDomain(req);
  const proto =
    (req && (req.get('x-forwarded-proto') || req.protocol)) || 'http';
  const hostHeader =
    (req && (req.get('x-forwarded-host') || req.get('host'))) ||
    req?.headers?.host ||
    widgetDomain;
  const loginOrigin = `${proto}://${hostHeader}`.replace(/\/$/, '');

  return {
    widgetDomain,
    loginOrigin,
    setDomainCommand: `/setdomain`,
    setDomainHint: `Open @BotFather → your bot → Bot Settings → Domain, then send: ${widgetDomain}`,
    localhostNote:
      widgetDomain === 'localhost' || widgetDomain === '127.0.0.1'
        ? 'Use the same hostname in the browser as in BotFather (localhost and 127.0.0.1 are different).'
        : null,
  };
}
