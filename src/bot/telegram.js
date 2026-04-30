import TelegramBot from 'node-telegram-bot-api';
import { resolveScopedTelegramUserId, touchTelegramUser } from '../access/telegramAccess.js';
import { appendChatMessage } from '../chat/chatLog.js';
import { getConfig } from '../config.js';
import { handleConfirmCallback, handleTextMessage } from '../core/orchestrator.js';
import { scheduleMemorySummaryRefresh } from '../memory/conversationSummary.js';
import { logger } from '../logger.js';

const confirmKeyboard = {
  inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }]],
};

function previewFromMessage(msg) {
  if (msg.text) return msg.text;
  if (msg.photo) return '[photo]';
  if (msg.document) return '[document]';
  if (msg.voice) return '[voice]';
  if (msg.sticker) return '[sticker]';
  return '[non-text message]';
}

function telegramErrorHint(err) {
  const msg = String(err?.message || err || '');
  if (/404|Unauthorized|401/i.test(msg)) {
    return (
      ' Invalid or revoked token. Paste the full token from @BotFather into the Control Panel (npm run gui) or .env.'
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    return ' Check network/DNS/firewall — the app must reach https://api.telegram.org';
  }
  return '';
}

export async function createBot(token, index = 0) {
  const bot = new TelegramBot(String(token || '').trim(), { polling: false });
  let botId = null;

  try {
    const me = await bot.getMe();
    botId = Number(me.id);
    logger.info(`Telegram[${index + 1}]: @${me.username} (id ${me.id}) — token OK`);
  } catch (err) {
    const hint = telegramErrorHint(err);
    logger.error(`Telegram getMe failed: ${err?.message || err}.${hint}`);
    throw new Error(`${err?.message || 'getMe failed'}${hint}`);
  }

  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err?.message || err}${telegramErrorHint(err)}`);
  });

  bot.on('message', async (msg) => {
    const rawUserId = msg.from?.id;
    let userId = null;
    const chatId = msg.chat?.id;
    if (!rawUserId || chatId == null) return;
    try {
      userId = resolveScopedTelegramUserId(botId, msg.from);
    } catch (e) {
      logger.error(`resolveScopedTelegramUserId failed: ${e.message}`);
      await bot.sendMessage(chatId, 'Could not open a scoped session for this account.').catch(() => {});
      return;
    }

    const access = touchTelegramUser(userId, msg.from, previewFromMessage(msg), rawUserId);
    if (access === 'blocked') {
      await bot.sendMessage(
        chatId,
        'Your access to this bot has been denied. If this is a mistake, contact the administrator.'
      );
      return;
    }
    if (access === 'pending') {
      await bot.sendMessage(
        chatId,
        'Thanks for reaching out. Your access request is pending until an administrator approves it in the Control Panel. You will be able to chat after approval.'
      );
      return;
    }

    if (!msg.text) {
      await bot.sendMessage(chatId, 'Please send text messages only.');
      return;
    }

    try {
      appendChatMessage(userId, 'user', msg.text);
      await bot.sendChatAction(chatId, 'typing');
      const out = await handleTextMessage(userId, msg.text);
      const opts = {};
      if (out.wantConfirmKeyboard) {
        opts.reply_markup = confirmKeyboard;
      }
      await bot.sendMessage(chatId, out.reply, opts);
      appendChatMessage(userId, 'assistant', out.reply);
      scheduleMemorySummaryRefresh(userId);
    } catch (e) {
      logger.error(`message handler: ${e.message}`);
      const errText = `Error: ${e.message}`;
      appendChatMessage(userId, 'assistant', errText);
      await bot.sendMessage(chatId, errText).catch(() => {});
    }
  });

  bot.on('callback_query', async (q) => {
    const rawUserId = q.from?.id;
    let userId = null;
    const chatId = q.message?.chat?.id;
    const qid = q.id;
    if (!rawUserId || chatId == null) return;
    try {
      userId = resolveScopedTelegramUserId(botId, q.from);
    } catch (e) {
      logger.error(`resolveScopedTelegramUserId callback failed: ${e.message}`);
      await bot.answerCallbackQuery(qid, { text: 'Session error' }).catch(() => {});
      return;
    }

    const access = touchTelegramUser(userId, q.from, '[callback]', rawUserId);
    if (access === 'blocked') {
      await bot.answerCallbackQuery(qid, { text: 'Access denied' }).catch(() => {});
      return;
    }
    if (access === 'pending') {
      await bot.answerCallbackQuery(qid, { text: 'Pending approval' }).catch(() => {});
      return;
    }

    const accepted = q.data === 'yes';
    try {
      await bot.answerCallbackQuery(qid);
      appendChatMessage(userId, 'user', accepted ? '[Confirm: Yes]' : '[Confirm: No]');
      await bot.sendChatAction(chatId, 'typing');
      const out = await handleConfirmCallback(userId, accepted);
      await bot.sendMessage(chatId, out.reply);
      appendChatMessage(userId, 'assistant', out.reply);
      scheduleMemorySummaryRefresh(userId);
    } catch (e) {
      logger.error(`callback handler: ${e.message}`);
      const errText = `Error: ${e.message}`;
      appendChatMessage(userId, 'assistant', errText);
      await bot.sendMessage(chatId, errText).catch(() => {});
    }
  });

  await bot.startPolling();
  logger.info(`Telegram[${index + 1}] bot polling started`);
  return bot;
}
