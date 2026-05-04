import { getDb } from '../db.js';

/**
 * Wipes all user memory and local chat history: pending_confirm, chat_log, soul (events + user_records CASCADE).
 * Does not touch telegram_users (access list) or settings.
 */
export function clearAllStoredMemory() {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM pending_confirm').run();
    db.prepare('DELETE FROM chat_log').run();
    db.prepare('DELETE FROM soul').run();
  })();
}
