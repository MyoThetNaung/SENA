import express from 'express';
import { reloadConfig } from '../config.js';
import {
  checkTelegramAllowlist,
  checkGoogleAllowlist,
  checkSoulUserAllowlist,
  activateAllowlistUser,
  activateGoogleAllowlistUser,
  normalizeTelegramUsername,
  ACCOUNT_DISABLED_MESSAGE,
} from '../access/telegramAllowlist.js';
import { verifyTelegramLoginPayload, getTelegramLoginBotToken } from './telegramLogin.js';
import { verifyAdminPassword } from './adminUsers.js';
import {
  createSession,
  destroySession,
  sessionCookieOptions,
  sessionClearCookieOptions,
  getSessionCookieName,
  pruneExpiredSessions,
} from './sessions.js';
import { attachSession } from './middleware.js';
import { authLoginRateLimit } from './rateLimit.js';
import { recordTelegramLoginHash, pruneTelegramLoginUsed } from './telegramLoginUsed.js';
import {
  storeGoogleOAuthState,
  consumeGoogleOAuthState,
  pruneGoogleOAuthStates,
} from './googleOAuthState.js';
import {
  isGoogleOAuthConfigured,
  buildGoogleAuthUrl,
  createOAuthState,
  resolveGoogleRedirectUri,
  exchangeGoogleAuthCode,
  fetchGoogleUserInfo,
  normalizeGoogleEmail,
} from './googleOAuth.js';
import { getConfig } from '../config.js';
import { buildTelegramProfileUrl, normalizeTelegramHandle } from '../util/telegramLink.js';

const GOOGLE_STATE_COOKIE = 'sena_google_oauth_state';

/** @param {import('express').Request} req */
function oauthStateCookieOptions(req) {
  const base = sessionCookieOptions(req);
  return { ...base, maxAge: 10 * 60 * 1000 };
}

/**
 * Safari often drops Set-Cookie on 302; a short 200 page with client redirect is more reliable.
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {string} token
 * @param {string} destination
 */
function finishBrowserLogin(res, req, token, destination) {
  res.cookie(getSessionCookieName(), token, sessionCookieOptions(req));
  res.setHeader('Cache-Control', 'no-store');
  const dest = destination.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Signing in…</title>
<meta http-equiv="refresh" content="0;url=${dest}">
</head><body><p>Signing in… <a href="${dest}">Continue</a></p>
<script>location.replace(${JSON.stringify(destination)});</script></body></html>`);
}

function requestOrigin(req) {
  const { senaPublicAccessUrl } = getConfig();
  const pub = String(senaPublicAccessUrl ?? '').trim();
  if (pub) {
    try {
      const u = new URL(pub.includes('://') ? pub : `http://${pub}`);
      return u.origin;
    } catch {
      /* fall through */
    }
  }
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function loginRedirect(req, params = {}) {
  const q = new URLSearchParams(params).toString();
  return `${requestOrigin(req)}/login${q ? `?${q}` : ''}`;
}

function appRedirect(req) {
  // User overview lives at /app in the Next.js UI.
  return `${requestOrigin(req)}/app`;
}

function buildLoginPageConfig() {
  const { adminTelegramUsername } = getConfig();
  const username = normalizeTelegramHandle(adminTelegramUsername);
  const url = buildTelegramProfileUrl(adminTelegramUsername);
  return {
    googleConfigured: isGoogleOAuthConfigured(),
    adminTelegram: url
      ? {
          username,
          url,
          label: 'Contact SENA Admin',
        }
      : null,
  };
}

export function createAuthRouter() {
  const router = express.Router();
  router.use(attachSession);

  router.get('/me', async (req, res) => {
    try {
      if (!req.session) {
        res.json({ authenticated: false });
        return;
      }
      if (req.session.role === 'user' && Number.isFinite(req.session.soulUserId)) {
        const allow = await checkSoulUserAllowlist(req.session.soulUserId);
        if (!allow.allowed) {
          if (req.sessionToken) await destroySession(req.sessionToken);
          res.clearCookie(getSessionCookieName(), sessionClearCookieOptions(req));
          res.json({
            authenticated: false,
            accountDisabled: true,
            message: ACCOUNT_DISABLED_MESSAGE,
          });
          return;
        }
      }
      res.json({
        authenticated: true,
        role: req.session.role,
        soulUserId: req.session.soulUserId ?? null,
        telegramUserId: req.session.telegramUserId ?? null,
        adminId: req.session.adminId ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/login-config', async (req, res) => {
    try {
      reloadConfig();
      res.json(buildLoginPageConfig());
    } catch (e) {
      res.status(500).json({ googleConfigured: false, adminTelegram: null, error: e.message });
    }
  });

  router.get('/google-config', async (req, res) => {
    try {
      reloadConfig();
      const cfg = buildLoginPageConfig();
      res.json({ configured: cfg.googleConfigured, adminTelegram: cfg.adminTelegram });
    } catch (e) {
      res.status(500).json({ configured: false, error: e.message });
    }
  });

  router.get('/google', authLoginRateLimit, async (req, res) => {
    try {
      reloadConfig();
      if (!isGoogleOAuthConfigured()) {
        res.redirect(loginRedirect(req, { error: 'Google Sign-In is not configured on the server.' }));
        return;
      }
      const state = createOAuthState();
      await storeGoogleOAuthState(state);
      res.cookie(GOOGLE_STATE_COOKIE, state, oauthStateCookieOptions(req));
      res.redirect(buildGoogleAuthUrl(req, state));
    } catch (e) {
      res.redirect(loginRedirect(req, { error: e.message || 'Could not start Google sign-in.' }));
    }
  });

  router.get('/google/callback', authLoginRateLimit, async (req, res) => {
    const clearState = () => res.clearCookie(GOOGLE_STATE_COOKIE, sessionClearCookieOptions(req));
    try {
      reloadConfig();
      const err = String(req.query.error || '').trim();
      if (err) {
        clearState();
        res.redirect(loginRedirect(req, { error: 'Google sign-in was cancelled.' }));
        return;
      }

      const state = String(req.query.state || '');
      const savedState = String(req.cookies?.[GOOGLE_STATE_COOKIE] || '');
      const cookieOk = Boolean(state && savedState && state === savedState);
      const dbOk = await consumeGoogleOAuthState(state);
      clearState();
      if (!state || (!cookieOk && !dbOk)) {
        res.redirect(loginRedirect(req, { error: 'Invalid sign-in state. Try again.' }));
        return;
      }

      const code = String(req.query.code || '').trim();
      if (!code) {
        res.redirect(loginRedirect(req, { error: 'Google did not return an authorization code.' }));
        return;
      }

      const redirectUri = resolveGoogleRedirectUri(req);
      const tokenData = await exchangeGoogleAuthCode(code, redirectUri);
      const profile = await fetchGoogleUserInfo(tokenData.access_token);

      if (!profile.email_verified) {
        res.redirect(
          loginRedirect(req, { error: 'Your Google account email is not verified.' })
        );
        return;
      }

      const email = normalizeGoogleEmail(profile.email);
      if (!email) {
        res.redirect(loginRedirect(req, { error: 'Google did not provide an email address.' }));
        return;
      }

      const check = await checkGoogleAllowlist({ email, googleSub: profile.sub });
      if (!check.allowed) {
        const msg =
          check.reason === 'disabled'
            ? ACCOUNT_DISABLED_MESSAGE
            : 'This Google account is not registered. Ask your administrator to invite your email first.';
        res.redirect(loginRedirect(req, { error: msg }));
        return;
      }

      const activated = await activateGoogleAllowlistUser(check.row, {
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      });

      const { token } = await createSession({
        role: 'user',
        soulUserId: activated.soulUserId,
      });

      finishBrowserLogin(res, req, token, appRedirect(req));
    } catch (e) {
      clearState();
      res.redirect(loginRedirect(req, { error: e.message || 'Google sign-in failed.' }));
    }
  });

  router.post('/telegram', authLoginRateLimit, async (req, res) => {
    try {
      reloadConfig();
      const data = req.body || {};
      const verified = verifyTelegramLoginPayload(data, getTelegramLoginBotToken());
      if (!verified.ok) {
        res.status(401).json({ ok: false, error: verified.error });
        return;
      }

      const { user } = verified;
      const username = normalizeTelegramUsername(user.username);
      if (!username && !Number.isFinite(user.id)) {
        res.status(400).json({
          ok: false,
          error: 'Your Telegram account has no @username. Set one in Telegram Settings or ask admin to invite you by user id.',
        });
        return;
      }

      const check = await checkTelegramAllowlist({ username, telegramUserId: user.id });
      if (!check.allowed) {
        const msg =
          check.reason === 'disabled'
            ? ACCOUNT_DISABLED_MESSAGE
            : check.reason === 'no_username'
              ? 'Your Telegram account has no @username. Set one in Telegram Settings, or ask admin to add your numeric user id.'
              : 'This Telegram account is not registered. Ask your administrator to add your @username first.';
        res.status(403).json({ ok: false, error: msg, code: check.reason });
        return;
      }

      const recorded = await recordTelegramLoginHash(verified.loginHash, user.id);
      if (!recorded) {
        res.status(401).json({ ok: false, error: 'This login was already used. Sign in again with Telegram.' });
        return;
      }

      const activated = await activateAllowlistUser(check.row, user);

      const { token } = await createSession({
        role: 'user',
        soulUserId: activated.soulUserId,
        telegramUserId: activated.telegramUserId,
      });

      res.cookie(getSessionCookieName(), token, sessionCookieOptions(req));
      res.json({
        ok: true,
        role: 'user',
        soulUserId: activated.soulUserId,
        username: activated.username,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/admin/login', authLoginRateLimit, async (req, res) => {
    try {
      const email = String((req.body || {}).email ?? '').trim();
      const password = String((req.body || {}).password ?? '');
      const admin = await verifyAdminPassword(email, password);
      if (!admin) {
        res.status(401).json({ ok: false, error: 'Invalid email or password' });
        return;
      }
      const { token } = await createSession({ role: 'admin', adminId: admin.id });
      res.cookie(getSessionCookieName(), token, sessionCookieOptions(req));
      res.json({ ok: true, role: 'admin', email: admin.email });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      if (req.sessionToken) await destroySession(req.sessionToken);
      res.clearCookie(getSessionCookieName(), sessionClearCookieOptions(req));
      res.clearCookie(GOOGLE_STATE_COOKIE, sessionClearCookieOptions(req));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

export async function initAuth() {
  await pruneExpiredSessions();
  await pruneTelegramLoginUsed();
  await pruneGoogleOAuthStates();
}
