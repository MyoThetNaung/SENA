/**
 * In-memory sliding-window rate limiter for login endpoints.
 */

const buckets = new Map();

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {{ windowMs?: number, max?: number, keyPrefix?: string }} opts
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, keyPrefix = '' } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}${clientKey(req)}:${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
      return;
    }
    next();
  };
}

export const authLoginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'auth:',
});
