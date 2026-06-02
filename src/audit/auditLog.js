import { query } from '../db.js';

/** Known event types (shown in admin filter dropdown). */
export const AUDIT_EVENT_TYPES = [
  'auth.admin_login',
  'auth.logout',
  'auth.google_login',
  'auth.telegram_login',
  'settings.update',
  'settings.reset_telegram',
  'bot.start',
  'bot.stop',
  'chat.send',
  'chat.clear_session',
  'user.profile_update',
  'user.memory_update',
  'user.chat_send',
  'user.chat_clear',
  'user.calendar_delete',
  'soul.update',
  'soul.clear',
  'soul.copy',
  'soul.copy_bot_persona',
  'memory.clear_all',
  'access.set',
  'access.clear_all',
  'allowlist.invite',
  'allowlist.update',
  'allowlist.delete',
  'allowlist.clear_all',
  'data.calendar_delete',
  'data.records_delete',
  'data.pending_delete',
  'models.download_default',
  'llm.test_connection',
  'api.request',
  'knowledge.ingest',
  'knowledge.ingest_batch',
  'knowledge.delete',
];

const REDACT_BODY_KEYS = new Set([
  'password',
  'telegramBotToken',
  'telegramBotTokenAdd',
  'llamaServerApiKey',
  'openaiApiKey',
  'openrouterApiKey',
  'geminiApiKey',
  'databaseUrl',
]);

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_BODY_KEYS.has(k)) {
      out[k] = '[redacted]';
    } else if (k === 'body' && v && typeof v === 'object') {
      const body = {};
      for (const [bk, bv] of Object.entries(v)) {
        body[bk] = REDACT_BODY_KEYS.has(bk) ? '[redacted]' : bv;
      }
      out.body = body;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {import('express').Request} req
 */
export function actorFromRequest(req) {
  const s = req.session;
  if (!s) return { actorRole: null, actorAdminId: null, actorSoulUserId: null };
  if (s.role === 'admin') {
    return {
      actorRole: 'admin',
      actorAdminId: s.adminId != null ? Number(s.adminId) : null,
      actorSoulUserId: null,
    };
  }
  if (s.role === 'user') {
    return {
      actorRole: 'user',
      actorAdminId: null,
      actorSoulUserId: Number.isFinite(Number(s.soulUserId)) ? Number(s.soulUserId) : null,
    };
  }
  return { actorRole: s.role || null, actorAdminId: null, actorSoulUserId: null };
}

/**
 * Map HTTP route to a stable audit event type.
 * @param {import('express').Request} req
 */
export function resolveAuditEventType(req) {
  const method = req.method;
  const path = req.path || req.url?.split('?')[0] || '';

  if (path === '/api/auth/admin/login' && method === 'POST') return 'auth.admin_login';
  if (path === '/api/auth/logout' && method === 'POST') return 'auth.logout';
  if (path.startsWith('/api/auth/google') && method === 'GET') return 'auth.google_login';
  if (path === '/api/auth/telegram' && method === 'POST') return 'auth.telegram_login';

  if (path === '/api/settings' && method === 'POST') return 'settings.update';
  if (path === '/api/settings/reset-telegram' && method === 'POST') return 'settings.reset_telegram';
  if (path === '/api/bot/start' && method === 'POST') return 'bot.start';
  if (path === '/api/bot/stop' && method === 'POST') return 'bot.stop';
  if (path === '/api/chat/send' && method === 'POST') return 'chat.send';
  if (path === '/api/chat/clear-session' && method === 'POST') return 'chat.clear_session';
  if (path === '/api/memory/clear-all' && method === 'POST') return 'memory.clear_all';
  if (path === '/api/access/set' && method === 'POST') return 'access.set';
  if (path === '/api/access/clear-all' && method === 'POST') return 'access.clear_all';
  if (path === '/api/data/calendar/delete' && method === 'POST') return 'data.calendar_delete';
  if (path === '/api/data/records/delete' && method === 'POST') return 'data.records_delete';
  if (path === '/api/data/pending/delete' && method === 'POST') return 'data.pending_delete';
  if (path === '/api/models/download-default' && method === 'POST') return 'models.download_default';
  if (path === '/api/llm/test-connection' && method === 'POST') return 'llm.test_connection';
  if (path === '/api/admin/allowlist' && method === 'POST') return 'allowlist.invite';
  if (path === '/api/admin/allowlist/clear-all' && method === 'POST') return 'allowlist.clear_all';
  if (/^\/api\/admin\/allowlist\/\d+$/.test(path) && method === 'PATCH') return 'allowlist.update';
  if (/^\/api\/admin\/allowlist\/\d+$/.test(path) && method === 'DELETE') return 'allowlist.delete';
  if (/^\/api\/soul\/\d+$/.test(path) && method === 'PUT') return 'soul.update';
  if (/^\/api\/soul\/\d+\/clear$/.test(path) && method === 'POST') return 'soul.clear';
  if (path === '/api/soul/copy' && method === 'POST') return 'soul.copy';
  if (path === '/api/soul/copy-bot-persona' && method === 'POST') return 'soul.copy_bot_persona';

  if (path === '/api/user/profile' && method === 'PUT') return 'user.profile_update';
  if (path === '/api/user/memory' && method === 'PUT') return 'user.memory_update';
  if (path === '/api/user/chat/send' && method === 'POST') return 'user.chat_send';
  if (path === '/api/user/chat/clear' && method === 'POST') return 'user.chat_clear';
  if (/^\/api\/user\/calendar\/\d+$/.test(path) && method === 'DELETE') return 'user.calendar_delete';
  if (path === '/api/user/memory/records/delete' && method === 'POST') return 'user.records_delete';

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path.startsWith('/api/')) {
    return 'api.request';
  }
  return null;
}

export function shouldAuditRequest(req) {
  const path = req.path || '';
  if (path === '/api/health') return false;
  const method = req.method;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path.startsWith('/api/')) return true;
  if (method === 'GET' && path.startsWith('/api/auth/google')) return true;
  return false;
}

/**
 * @param {object} p
 */
export async function logAudit(p) {
  try {
    const metadata = sanitizeMetadata(p.metadata || {});
    await query(
      `INSERT INTO audit_logs (
        event_type, actor_role, actor_admin_id, actor_soul_user_id, target_soul_user_id,
        ip_address, user_agent, http_method, http_path, status_code, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        String(p.eventType || 'api.request'),
        p.actorRole || null,
        p.actorAdminId ?? null,
        p.actorSoulUserId ?? null,
        p.targetSoulUserId ?? null,
        p.ipAddress || null,
        p.userAgent || null,
        p.httpMethod || null,
        p.httpPath || null,
        p.statusCode ?? null,
        JSON.stringify(metadata),
      ]
    );
  } catch {
    /* never break requests */
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function logAuditFromRequest(req, res, overrides = {}) {
  const eventType = overrides.eventType || resolveAuditEventType(req);
  if (!eventType) return;
  const actor = actorFromRequest(req);
  let targetSoulUserId = overrides.targetSoulUserId ?? null;
  if (targetSoulUserId == null) {
    const m = (req.path || '').match(/\/soul\/(\d+)/) || (req.path || '').match(/\/calendar\/(\d+)/);
    if (m) targetSoulUserId = Number(req.body?.userId ?? req.body?.targetUserId ?? req.params?.userId);
    if (req.path?.startsWith('/api/user/') && actor.actorSoulUserId != null) {
      targetSoulUserId = actor.actorSoulUserId;
    }
    const soulMatch = (req.path || '').match(/\/api\/soul\/(\d+)/);
    if (soulMatch) targetSoulUserId = Number(soulMatch[1]);
  }

  await logAudit({
    eventType,
    ...actor,
    targetSoulUserId,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
    httpMethod: req.method,
    httpPath: req.path,
    statusCode: res.statusCode,
    metadata: {
      ...(req.body && typeof req.body === 'object' ? { body: req.body } : {}),
      ...overrides.metadata,
    },
  });
}

/**
 * @param {{ eventType?: string, actorSoulUserId?: number, limit?: number, offset?: number }} opts
 */
export async function listAuditLogs(opts = {}) {
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const eventType = opts.eventType ? String(opts.eventType).trim() : null;
  const actorSoulUserId =
    opts.actorSoulUserId != null && Number.isFinite(Number(opts.actorSoulUserId))
      ? Number(opts.actorSoulUserId)
      : null;

  const args = [];
  const clauses = [];
  if (eventType) {
    args.push(eventType);
    clauses.push(`event_type = $${args.length}`);
  }
  if (actorSoulUserId != null) {
    args.push(actorSoulUserId);
    const n = args.length;
    clauses.push(
      `(actor_soul_user_id = $${n} OR target_soul_user_id = $${n})`
    );
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  args.push(limit, offset);

  const r = await query(
    `SELECT id, created_at, event_type, actor_role, actor_admin_id, actor_soul_user_id,
            target_soul_user_id, ip_address, user_agent, http_method, http_path, status_code, metadata
     FROM audit_logs${where}
     ORDER BY id DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );

  const countArgs = [...args.slice(0, args.length - 2)];
  const countR = await query(
    `SELECT COUNT(*)::int AS n FROM audit_logs${where}`,
    countArgs
  );

  return {
    total: countR.rows[0]?.n ?? 0,
    limit,
    offset,
    rows: r.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      eventType: row.event_type,
      actorRole: row.actor_role,
      actorAdminId: row.actor_admin_id != null ? Number(row.actor_admin_id) : null,
      actorSoulUserId: row.actor_soul_user_id != null ? Number(row.actor_soul_user_id) : null,
      targetSoulUserId: row.target_soul_user_id != null ? Number(row.target_soul_user_id) : null,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      httpMethod: row.http_method,
      httpPath: row.http_path,
      statusCode: row.status_code,
      metadata: row.metadata || {},
    })),
  };
}
