import crypto from 'crypto';
import { getConfig } from '../config.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const OAUTH_SCOPES = 'openid email profile';

export function normalizeGoogleEmail(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return s && s.includes('@') ? s : null;
}

/** Deterministic soul user id for a Google account (stable across logins). */
export function soulUserIdFromGoogleSub(sub) {
  const id = String(sub ?? '').trim();
  if (!id) throw new Error('Invalid Google subject');
  const buf = crypto.createHash('sha256').update(`sena:google:${id}`).digest();
  const n = Number(buf.readBigUInt64BE(0) % BigInt(9007199254740990)) + 1;
  return n;
}

export function isGoogleOAuthConfigured() {
  const { googleClientId, googleClientSecret } = getConfig();
  return Boolean(googleClientId && googleClientSecret);
}

/**
 * @param {import('express').Request} req
 */
export function resolveGoogleRedirectUri(req) {
  const { googleRedirectUri } = getConfig();
  if (googleRedirectUri) return googleRedirectUri;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

export function createOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * @param {import('express').Request} req
 */
export function buildGoogleAuthUrl(req, state) {
  const { googleClientId } = getConfig();
  const redirectUri = resolveGoogleRedirectUri(req);
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * @param {string} code
 * @param {string} redirectUri
 */
export async function exchangeGoogleAuthCode(code, redirectUri) {
  const { googleClientId, googleClientSecret } = getConfig();
  const body = new URLSearchParams({
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Google token exchange failed (${res.status})`);
  }
  if (!data.access_token) throw new Error('Google did not return an access token');
  return data;
}

/**
 * @param {string} accessToken
 */
export async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || `Google userinfo failed (${res.status})`);
  }
  return data;
}
