import { query } from '../db.js';

/**
 * Wipes all user memory and local chat history: pending_confirm, chat_log, soul (events + user_records CASCADE).
 * Does not touch telegram_users (access list) or settings.
 */
export async function clearAllStoredMemory() {
  await query('DELETE FROM pending_confirm');
  await query('DELETE FROM chat_log');
  await query('DELETE FROM soul');
}
