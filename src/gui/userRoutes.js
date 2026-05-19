import express from 'express';
import { readSessionToken } from '../auth/middleware.js';
import { getSessionByToken } from '../auth/sessions.js';
import { reloadConfig, getConfig } from '../config.js';
import {
  appendChatMessage,
  clearChatMessagesForUser,
  listChatMessages,
} from '../chat/chatLog.js';
import { getSoul, setSoulContent, copySoulFromTo, copyBotPersonaFromTo } from '../memory/soul.js';
import { scheduleMemorySummaryRefresh } from '../memory/conversationSummary.js';
import { getPool, query } from '../db.js';
import { listEventsForUser, deleteEventForUser } from '../calendar/calendar.js';
import { listUserRecords } from '../records/userRecords.js';
import { getAllowlistBySoulUserId } from '../access/telegramAllowlist.js';
import { SCOPED_USER_ID_OFFSET } from '../access/telegramAccess.js';
import { handleImageMessage, handleTextMessage } from '../core/orchestrator.js';
import { getBotStatus } from './bot-runner.js';
import { probeLlamaServerReachable } from '../llm/catalog.js';
import { listCommonTimezones, normalizeTimezone } from '../util/timezone.js';
import { ensureDefaultUserTimezone, DEFAULT_USER_TIMEZONE } from '../memory/soul.js';
import { getUserMonthlyTokenUsage, monthKey } from '../llm/tokenUsage.js';

function soulUserId(req) {
  return Number(req.session.soulUserId);
}

/**
 * Soul rows the logged-in user is allowed to read or edit:
 * 1. their primary web soul (`soulUserId` from session), plus
 * 2. any Telegram-scoped souls (one per bot they've used) tied to their `telegram_user_id`.
 * @param {number} primaryUserId
 * @returns {Promise<Array<{ userId: number, label: string, scoped: boolean, botId: number|null }>>}
 */
async function listOwnedSessions(primaryUserId) {
  const sessions = [{ userId: primaryUserId, label: 'Web account', scoped: false, botId: null }];

  const allow = await getAllowlistBySoulUserId(primaryUserId);
  const tid =
    allow?.telegram_user_id != null && Number.isFinite(Number(allow.telegram_user_id))
      ? Number(allow.telegram_user_id)
      : null;
  if (!tid) return sessions;

  const r = await query(
    `SELECT id, bot_id, username, first_name, last_seen
     FROM telegram_identity_map
     WHERE telegram_user_id = $1
     ORDER BY last_seen DESC NULLS LAST, id`,
    [tid]
  );
  for (const row of r.rows) {
    const scopedUserId = SCOPED_USER_ID_OFFSET + Number(row.id);
    if (!Number.isFinite(scopedUserId)) continue;
    const label =
      `Telegram bot ${row.bot_id}` +
      (row.username ? ` — @${row.username}` : row.first_name ? ` — ${row.first_name}` : '');
    sessions.push({
      userId: scopedUserId,
      label,
      scoped: true,
      botId: Number(row.bot_id) || null,
    });
  }
  return sessions;
}

async function resolveTargetSessionId(req) {
  const primary = soulUserId(req);
  const raw = req.query.sessionUserId ?? req.body?.sessionUserId;
  if (raw == null || raw === '') return primary;
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return primary;
  if (requested === primary) return primary;
  const owned = await listOwnedSessions(primary);
  return owned.some((s) => s.userId === requested) ? requested : primary;
}

async function probeLlmOnline() {
  reloadConfig();
  const c = getConfig();
  if (c.llmProvider === 'llama-server') {
    const url = c.llamaServerUrl.replace(/\/$/, '');
    try {
      return await probeLlamaServerReachable(url, 2500);
    } catch {
      return false;
    }
  }
  if (c.llmProvider === 'ollama') {
    const ob = c.ollamaBaseUrl.replace(/\/$/, '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const probe = await fetch(`${ob}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      return probe.ok;
    } catch {
      return false;
    }
  }
  return true;
}

export function createUserRouter() {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      req.sessionToken = token || null;
      req.session = token ? await getSessionByToken(token) : null;
      if (req.session?.role !== 'user' || !Number.isFinite(req.session.soulUserId)) {
        res.status(401).json({ ok: false, error: 'User login required' });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  router.get('/overview', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      await ensureDefaultUserTimezone(userId);
      const soul = await getSoul(userId);
      const allow = await getAllowlistBySoulUserId(userId);
      const bot = getBotStatus();
      const llmOnline = await probeLlmOnline();
      const prof = soul.preferences?.profile || {};
      const tz = normalizeTimezone(prof.timezone) || DEFAULT_USER_TIMEZONE;
      const displayName =
        String(soul.display_name || '').trim() ||
        String(allow?.email || '').trim() ||
        (allow?.username ? `@${allow.username}` : '') ||
        'User';

      let telegramLine = 'Not linked';
      if (allow?.username) telegramLine = `@${allow.username}`;
      else if (allow?.telegram_user_id) telegramLine = `Telegram id ${allow.telegram_user_id}`;
      else if (allow?.email) telegramLine = allow.email;

      const usageMonth = String(req.query.month || monthKey()).trim() || monthKey();
      const tokenUsage = await getUserMonthlyTokenUsage(userId, usageMonth);

      res.json({
        userId,
        displayName,
        email: allow?.email || null,
        timezone: tz,
        llmOnline,
        bot: {
          running: bot.running,
          botCount: bot.botCount,
          configuredBotCount: bot.configuredBotCount,
        },
        telegramLine,
        allowlistStatus: allow?.status || null,
        tokenUsage,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/timezones', (req, res) => {
    res.json({ timezones: listCommonTimezones(), defaultTimezone: DEFAULT_USER_TIMEZONE });
  });

  router.get('/profile', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      await ensureDefaultUserTimezone(userId);
      res.json(await getSoul(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/profile', async (req, res) => {
    try {
      const userId = soulUserId(req);
      const b = req.body || {};
      await getPool();
      await setSoulContent(userId, {
        display_name: b.display_name,
        profile: b.profile,
      });
      res.json({ ok: true, soul: await getSoul(userId) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/sessions', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const sessions = await listOwnedSessions(primaryUserId);
      res.json({ primaryUserId, sessions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/souls', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const owned = await listOwnedSessions(primaryUserId);
      const souls = [];
      for (const s of owned) {
        const soul = await getSoul(s.userId);
        const prof = soul.preferences?.profile || {};
        const summary = String(prof.memorySummary || prof.whoAmI || '').slice(0, 280);
        souls.push({
          userId: s.userId,
          label: s.label,
          scoped: s.scoped,
          botId: s.botId,
          displayName: soul.display_name || null,
          summaryPreview: summary,
          timezone: prof.timezone || null,
        });
      }
      res.json({ primaryUserId, souls });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/memory', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const targetUserId = await resolveTargetSessionId(req);
      await ensureDefaultUserTimezone(targetUserId);
      const soul = await getSoul(targetUserId);
      const records = await listUserRecords(targetUserId, { limit: 200 });
      const sessions = await listOwnedSessions(primaryUserId);
      res.json({ soul, records, sessions, primaryUserId, sessionUserId: targetUserId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/memory', async (req, res) => {
    try {
      const b = req.body || {};
      await getPool();
      const targetUserId = await resolveTargetSessionId(req);
      await setSoulContent(targetUserId, {
        display_name: b.display_name,
        profile: b.profile,
        botPersona: b.botPersona,
      });
      res.json({ ok: true, soul: await getSoul(targetUserId), sessionUserId: targetUserId });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post('/memory/copy', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const owned = await listOwnedSessions(primaryUserId);
      const ownedIds = new Set(owned.map((s) => s.userId));
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!ownedIds.has(fromUserId) || !ownedIds.has(toUserId)) {
        res.status(400).json({ ok: false, error: 'You can only copy between your own sessions.' });
        return;
      }
      await copySoulFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: await getSoul(toUserId), sessionUserId: toUserId });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post('/memory/copy-bot-persona', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const owned = await listOwnedSessions(primaryUserId);
      const ownedIds = new Set(owned.map((s) => s.userId));
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      if (!ownedIds.has(fromUserId) || !ownedIds.has(toUserId)) {
        res.status(400).json({ ok: false, error: 'You can only copy between your own sessions.' });
        return;
      }
      await copyBotPersonaFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: await getSoul(toUserId), sessionUserId: toUserId });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/chat', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const rows = await listChatMessages({ userId, limit });
      res.json({ messages: rows, userId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/chat/send', async (req, res) => {
    try {
      reloadConfig();
      await getPool();
      const cfg = getConfig();
      const userId = soulUserId(req);
      const text = String((req.body || {}).text ?? '').trim();
      const imageDataUrl = String((req.body || {}).imageDataUrl ?? '').trim();
      if (!text && !imageDataUrl) {
        res.status(400).json({ ok: false, error: 'Message text or image is required.' });
        return;
      }
      const userPreview = text || '[image]';
      await appendChatMessage(userId, 'user', userPreview);
      const startedAt = Date.now();
      try {
        const out = imageDataUrl
          ? await handleImageMessage(userId, text, imageDataUrl)
          : await handleTextMessage(userId, text);
        await appendChatMessage(userId, 'assistant', out.reply);
        scheduleMemorySummaryRefresh(userId);
        res.json({
          ok: true,
          reply: out.reply,
          meta: {
            elapsedMs: Date.now() - startedAt,
            provider: String(cfg.llmProvider || '').trim() || 'unknown',
            model: String(cfg.llmModel || '').trim() || 'unknown',
          },
        });
      } catch (e) {
        const errText = `Error: ${e.message}`;
        await appendChatMessage(userId, 'assistant', errText);
        res.status(500).json({ ok: false, error: e.message });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/chat/clear', async (req, res) => {
    try {
      const userId = soulUserId(req);
      await getPool();
      const deleted = await clearChatMessagesForUser(userId);
      res.json({ ok: true, deleted });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/telegram', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const row = await getAllowlistBySoulUserId(userId);
      if (!row) {
        res.json({ linked: false, username: null, telegramUserId: null, status: null });
        return;
      }
      res.json({
        linked: true,
        username: row.username || null,
        telegramUserId: row.telegram_user_id != null ? Number(row.telegram_user_id) : null,
        email: row.email || null,
        status: row.status,
        invitedAt: row.invited_at,
        firstLoginAt: row.first_login_at,
        lastSeen: row.last_seen,
        notes: row.notes || '',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/access', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const row = await getAllowlistBySoulUserId(userId);
      if (!row) {
        res.json({ entry: null });
        return;
      }
      res.json({
        entry: {
          id: row.id,
          username: row.username,
          telegramUserId: row.telegram_user_id,
          email: row.email,
          status: row.status,
          invitedAt: row.invited_at,
          firstLoginAt: row.first_login_at,
          lastSeen: row.last_seen,
          notes: row.notes || '',
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/calendar', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const events = await listEventsForUser(userId, limit);
      res.json({ events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/calendar/:id', async (req, res) => {
    try {
      const userId = soulUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'Invalid event id' });
        return;
      }
      await getPool();
      const ok = await deleteEventForUser(userId, id);
      res.json({ ok });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/bot/status', (req, res) => {
    try {
      const bot = getBotStatus();
      res.json({
        running: bot.running,
        botCount: bot.botCount,
        configuredBotCount: bot.configuredBotCount,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
