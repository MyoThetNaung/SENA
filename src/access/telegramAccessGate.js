import {
  checkTelegramAllowlist,
  activateAllowlistUser,
  touchAllowlistSeen,
  normalizeTelegramUsername,
} from './telegramAllowlist.js';
import { logger } from '../logger.js';

/**
 * Invite-only gate for Telegram bot + web.
 * @param {number|null} [scopedSoulUserId] When set (bot), chat/soul use this id.
 * @returns {'approved'|'blocked'|'no_username'}
 */
export async function gateTelegramAccess(from, messagePreview, scopedSoulUserId = null) {
  const username = normalizeTelegramUsername(from?.username);
  const telegramUserId = from?.id != null ? Number(from.id) : null;

  if (!username && !Number.isFinite(telegramUserId)) {
    return 'no_username';
  }

  const check = await checkTelegramAllowlist({ username, telegramUserId });
  if (!check.allowed) {
    if (check.reason === 'no_username') return 'no_username';
    logger.info(
      `Telegram access denied @${username || '?'} id=${telegramUserId ?? '?'} (${check.reason || 'not_invited'})`
    );
    return 'blocked';
  }

  try {
    const activated = await activateAllowlistUser(
      check.row,
      {
        id: telegramUserId,
        username: from?.username,
        first_name: from?.first_name,
      },
      scopedSoulUserId
    );
    await touchAllowlistSeen(activated.telegramUserId, activated.username);
    return 'approved';
  } catch (e) {
    logger.error(`activateAllowlistUser: ${e.message}`);
    return 'blocked';
  }
}
