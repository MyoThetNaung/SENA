import { getSessionByToken, getSessionCookieName } from './sessions.js';

export function readSessionToken(req) {
  const cookie = req.cookies?.[getSessionCookieName()];
  if (cookie) return String(cookie);
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

export async function attachSession(req, res, next) {
  try {
    const token = readSessionToken(req);
    req.session = token ? await getSessionByToken(token) : null;
    req.sessionToken = token || null;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(401).json({ ok: false, error: 'Admin login required' });
}

export function requireUser(req, res, next) {
  if (req.session?.role === 'user' && Number.isFinite(req.session.soulUserId)) return next();
  res.status(401).json({ ok: false, error: 'User login required' });
}

/** Admin or user with matching soul user id (for chat APIs). */
export function requireSelfOrAdmin(paramName = 'userId') {
  return (req, res, next) => {
    if (req.session?.role === 'admin') return next();
    const raw = req.params?.[paramName] ?? req.body?.userId ?? req.query?.userId;
    const uid = Number(raw);
    if (req.session?.role === 'user' && Number.isFinite(uid) && uid === req.session.soulUserId) {
      return next();
    }
    res.status(403).json({ ok: false, error: 'Forbidden' });
  };
}
