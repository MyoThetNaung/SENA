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
import { listEventsForOwner, deleteEventForOwner } from '../calendar/calendar.js';
import { deleteUserRecordById, listUserRecords } from '../records/userRecords.js';
import {
  checkSoulUserAllowlist,
  getAllowlistBySoulUserId,
  respondAccountDisabled,
} from '../access/telegramAllowlist.js';
import {
  listUserMemoryBots,
  listUserMemorySessions,
  listUserChatSessions,
  listAllOwnedMemorySessions,
  userOwnsMemorySession,
} from '../access/userMemorySessions.js';
import { handleImageMessage, handleTextMessage } from '../core/orchestrator.js';
import { applyTelegramTokenListChange, getBotStatusForOwner } from './bot-runner.js';
import {
  addBotForOwner,
  listBotsForOwner,
  removeBotForOwner,
} from '../access/userTelegramBots.js';
import { listBotAccessForOwner, setBotAccessStatusForOwner } from '../access/userBotAccess.js';
import { probeLlamaServerReachable } from '../llm/catalog.js';
import { listCommonTimezones, normalizeTimezone } from '../util/timezone.js';
import { ensureDefaultUserTimezone, DEFAULT_USER_TIMEZONE } from '../memory/soul.js';
import { getUserMonthlyTokenUsage, monthKey } from '../llm/tokenUsage.js';
import { listAuditLogs } from '../audit/auditLog.js';
import { embeddingsConfigured } from '../rag/embeddings.js';
import {
  ingestPersonalDocument,
  listPersonalDocuments,
  deletePersonalDocument,
} from '../rag/personalKnowledge.js';
import { extractTextFromUpload } from '../rag/textUpload.js';
import {
  addTask,
  listTasks,
  completeTask,
  deleteTask,
} from '../tasks/tasks.js';
import {
  getAssistantPreferences,
  setAssistantPreferences,
} from '../assistant/preferences.js';
import {
  saveConnectorCredentials,
  deleteConnectorCredentials,
  listConnectorTypesForUser,
  loadConnectorCredentials,
  CONNECTOR_JIRA,
} from '../connectors/credentials.js';
import { probeJiraCredentials } from '../connectors/jira.js';

function soulUserId(req) {
  return Number(req.session.soulUserId);
}

async function resolveTargetSessionId(req) {
  const primary = soulUserId(req);
  const raw = req.query.sessionUserId ?? req.body?.sessionUserId;
  if (raw == null || raw === '') return primary;
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return primary;
  if (requested === primary) return primary;
  const ok = await userOwnsMemorySession(primary, requested);
  return ok ? requested : primary;
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
      const allow = await checkSoulUserAllowlist(req.session.soulUserId);
      if (!allow.allowed) {
        respondAccountDisabled(res);
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
      const bot = getBotStatusForOwner(userId);
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

  router.get('/activity-log', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const limit = req.query.limit;
      const data = await listAuditLogs({ actorSoulUserId: userId, limit });
      res.json({ rows: data.rows, total: data.total });
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

  router.get('/memory/bots', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const bots = await listUserMemoryBots(primaryUserId);
      res.json({ bots, primaryUserId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/memory/sessions', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const botId = req.query.botId;
      const sessions = await listUserChatSessions(primaryUserId, botId);
      res.json({ primaryUserId, sessions, botId: botId ?? null });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/sessions', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const sessions = await listAllOwnedMemorySessions(primaryUserId);
      res.json({ primaryUserId, sessions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/souls', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const botId = req.query.botId != null && req.query.botId !== '' ? Number(req.query.botId) : null;
      let owned = await listAllOwnedMemorySessions(primaryUserId);
      if (Number.isFinite(botId)) {
        owned = owned.filter((s) => s.botId === botId);
      }
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
      const botId = req.query.botId;
      const sessions = Number.isFinite(Number(botId))
        ? await listUserMemorySessions(primaryUserId, botId)
        : await listAllOwnedMemorySessions(primaryUserId);
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
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      const okFrom = await userOwnsMemorySession(primaryUserId, fromUserId);
      const okTo = await userOwnsMemorySession(primaryUserId, toUserId);
      if (!okFrom || !okTo) {
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
      const fromUserId = Number((req.body || {}).fromUserId);
      const toUserId = Number((req.body || {}).toUserId);
      const okFrom = await userOwnsMemorySession(primaryUserId, fromUserId);
      const okTo = await userOwnsMemorySession(primaryUserId, toUserId);
      if (!okFrom || !okTo) {
        res.status(400).json({ ok: false, error: 'You can only copy between your own sessions.' });
        return;
      }
      await copyBotPersonaFromTo(fromUserId, toUserId);
      res.json({ ok: true, soul: await getSoul(toUserId), sessionUserId: toUserId });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post('/memory/records/delete', async (req, res) => {
    try {
      await getPool();
      const targetUserId = await resolveTargetSessionId(req);
      const id = Number((req.body || {}).id);
      if (!Number.isFinite(id) || id < 1) {
        res.status(400).json({ ok: false, error: 'Valid record id is required.' });
        return;
      }
      const ok = await deleteUserRecordById(targetUserId, id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'No record with that id for this session.' });
        return;
      }
      res.json({ ok: true, sessionUserId: targetUserId });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/chat/bots', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const bots = await listUserMemoryBots(primaryUserId);
      res.json({ bots, primaryUserId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/chat/sessions', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const botId = req.query.botId;
      const sessions = await listUserChatSessions(primaryUserId, botId);
      res.json({ primaryUserId, sessions, botId: botId ?? null });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/chat', async (req, res) => {
    try {
      await getPool();
      const primaryUserId = soulUserId(req);
      const rawUid = req.query.userId ?? req.query.sessionUserId;
      let userId = primaryUserId;
      if (rawUid != null && rawUid !== '') {
        const requested = Number(rawUid);
        if (Number.isFinite(requested)) {
          const ok = await userOwnsMemorySession(primaryUserId, requested);
          if (!ok) {
            res.status(403).json({ error: 'You do not have access to this chat session.' });
            return;
          }
          userId = requested;
        }
      }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const rows = await listChatMessages({ userId, limit });
      res.json({ messages: rows, userId, primaryUserId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/chat/send', async (req, res) => {
    try {
      reloadConfig();
      await getPool();
      const cfg = getConfig();
      const primaryUserId = soulUserId(req);
      const rawUid = (req.body || {}).userId ?? (req.body || {}).sessionUserId;
      let userId = primaryUserId;
      if (rawUid != null && rawUid !== '') {
        const requested = Number(rawUid);
        if (Number.isFinite(requested)) {
          const ok = await userOwnsMemorySession(primaryUserId, requested);
          if (!ok) {
            res.status(403).json({ ok: false, error: 'You do not have access to this chat session.' });
            return;
          }
          userId = requested;
        }
      }
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
      const primaryUserId = soulUserId(req);
      const rawUid = (req.body || {}).userId ?? (req.body || {}).sessionUserId;
      let userId = primaryUserId;
      if (rawUid != null && rawUid !== '') {
        const requested = Number(rawUid);
        if (Number.isFinite(requested)) {
          const ok = await userOwnsMemorySession(primaryUserId, requested);
          if (!ok) {
            res.status(403).json({ ok: false, error: 'You do not have access to this chat session.' });
            return;
          }
          userId = requested;
        }
      }
      await getPool();
      const deleted = await clearChatMessagesForUser(userId);
      res.json({ ok: true, deleted, userId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/telegram', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const row = await getAllowlistBySoulUserId(userId);
      const bots = await listBotsForOwner(userId);
      const base = {
        bots,
        linked: false,
        username: null,
        telegramUserId: null,
        email: null,
        status: null,
        invitedAt: null,
        firstLoginAt: null,
        lastSeen: null,
        notes: '',
      };
      if (!row) {
        res.json(base);
        return;
      }
      res.json({
        ...base,
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

  router.post('/telegram/bots', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const token = String((req.body || {}).token ?? '').trim();
      if (!token) {
        res.status(400).json({ ok: false, error: 'Bot token is required.' });
        return;
      }
      const bot = await addBotForOwner(userId, token);
      await applyTelegramTokenListChange().catch(() => {});
      res.json({ ok: true, bot });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete('/telegram/bots/:botId', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const botId = Number(req.params.botId);
      await removeBotForOwner(userId, botId);
      await applyTelegramTokenListChange().catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/access', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await listBotAccessForOwner(userId, status);
      const users = rows.map((row) => ({
        id: Number(row.id),
        botId: Number(row.bot_id),
        botUsername: row.bot_username || null,
        scopedUserId: Number(row.scoped_user_id),
        telegramUserId: row.telegram_user_id != null ? Number(row.telegram_user_id) : null,
        username: row.username || null,
        firstName: row.first_name || null,
        firstMessagePreview: row.first_message_preview || '',
        status: row.status,
        createdAt: row.created_at,
        lastSeen: row.last_seen,
      }));
      res.json({ users });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/access/:id', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const accessId = Number(req.params.id);
      const status = String((req.body || {}).status ?? '').toLowerCase();
      if (!['approved', 'blocked', 'pending'].includes(status)) {
        res.status(400).json({ ok: false, error: 'status must be approved, blocked, or pending' });
        return;
      }
      await setBotAccessStatusForOwner(userId, accessId, status);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/calendar', async (req, res) => {
    try {
      await getPool();
      const ownerId = soulUserId(req);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const events = await listEventsForOwner(ownerId, limit);
      res.json({ events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/calendar/:id', async (req, res) => {
    try {
      const ownerId = soulUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'Invalid event id' });
        return;
      }
      await getPool();
      const ok = await deleteEventForOwner(ownerId, id);
      res.json({ ok });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/bot/status', (req, res) => {
    try {
      const bot = getBotStatusForOwner(soulUserId(req));
      res.json({
        running: bot.running,
        botCount: bot.botCount,
        configuredBotCount: bot.configuredBotCount,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/knowledge/status', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const cfg = getConfig();
      const docs = cfg.ragEnabled ? await listPersonalDocuments(userId) : [];
      res.json({
        ok: true,
        ragEnabled: cfg.ragEnabled,
        embeddingsConfigured: embeddingsConfigured(),
        documentCount: docs.length,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/knowledge/documents', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const cfg = getConfig();
      if (!cfg.ragEnabled) {
        res.json({ ok: true, documents: [] });
        return;
      }
      const documents = await listPersonalDocuments(userId);
      res.json({ ok: true, documents });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/knowledge/ingest', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const cfg = getConfig();
      if (!cfg.ragEnabled) {
        res.status(400).json({ ok: false, error: 'Knowledge search is disabled.' });
        return;
      }
      if (!embeddingsConfigured()) {
        res.status(400).json({ ok: false, error: 'Embeddings are not configured.' });
        return;
      }
      const b = req.body || {};
      let content = String(b.content || '').trim();
      let documentTitle = b.documentTitle || b.title || 'Untitled';
      if (!content && (b.fileBase64 || b.fileName)) {
        const extracted = extractTextFromUpload({
          fileName: b.fileName,
          fileBase64: b.fileBase64,
        });
        content = extracted.text;
        documentTitle = extracted.title || documentTitle;
      }
      if (!content) {
        res.status(400).json({ ok: false, error: 'Document content is required.' });
        return;
      }
      const result = await ingestPersonalDocument(userId, {
        documentTitle,
        content,
        externalId: b.externalId,
        uri: b.uri,
        metadata: b.metadata,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete('/knowledge/documents/:id', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: 'Invalid document id' });
        return;
      }
      const ok = await deletePersonalDocument(userId, id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'Document not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/tasks', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const status = req.query.status ? String(req.query.status) : 'open';
      const tasks = await listTasks(userId, { status, limit: req.query.limit });
      res.json({ ok: true, tasks });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/tasks', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const b = req.body || {};
      const task = await addTask(userId, {
        title: b.title,
        due_at: b.due_at,
        priority: b.priority,
        notes: b.notes,
      });
      res.json({ ok: true, task });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post('/tasks/:id/complete', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const task = await completeTask(userId, Number(req.params.id));
      if (!task) {
        res.status(404).json({ ok: false, error: 'Task not found or already done.' });
        return;
      }
      res.json({ ok: true, task });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete('/tasks/:id', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const ok = await deleteTask(userId, Number(req.params.id));
      if (!ok) {
        res.status(404).json({ ok: false, error: 'Task not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/assistant/preferences', async (req, res) => {
    try {
      await getPool();
      const prefs = await getAssistantPreferences(soulUserId(req));
      res.json({ ok: true, preferences: prefs });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.patch('/assistant/preferences', async (req, res) => {
    try {
      await getPool();
      const b = req.body || {};
      const prefs = await setAssistantPreferences(soulUserId(req), {
        briefingEnabled: b.briefingEnabled,
        briefingHour: b.briefingHour,
      });
      res.json({ ok: true, preferences: prefs });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get('/integrations', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const connectors = await listConnectorTypesForUser(userId);
      res.json({
        ok: true,
        connectors,
        jira: connectors.some((c) => c.connectorType === CONNECTOR_JIRA),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.put('/integrations/jira', async (req, res) => {
    try {
      await getPool();
      const userId = soulUserId(req);
      const b = req.body || {};
      const baseUrl = String(b.baseUrl || b.base_url || '').trim();
      const email = String(b.email || '').trim();
      let apiToken = String(b.apiToken || b.api_token || '').trim();
      const existing = await loadConnectorCredentials(userId, CONNECTOR_JIRA);
      if (!baseUrl || !email) {
        res.status(400).json({ ok: false, error: 'baseUrl and email are required.' });
        return;
      }
      if (!apiToken) {
        if (!existing?.apiToken) {
          res.status(400).json({ ok: false, error: 'apiToken is required for new Jira connection.' });
          return;
        }
        apiToken = String(existing.apiToken);
      }
      await saveConnectorCredentials(userId, CONNECTOR_JIRA, { baseUrl, email, apiToken });
      await probeJiraCredentials(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete('/integrations/jira', async (req, res) => {
    try {
      await getPool();
      await deleteConnectorCredentials(soulUserId(req), CONNECTOR_JIRA);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  return router;
}
