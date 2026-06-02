import { getConfig, reloadConfig } from "../config.js";
import { getPool } from "../db.js";
import { runReminderTick } from "./processor.js";
import { logger } from "../logger.js";

let timer = null;
let running = false;

export async function startReminderScheduler() {
  if (timer) return;
  reloadConfig();
  const cfg = getConfig();
  if (!cfg.remindersEnabled) {
    logger.info("Proactive reminders disabled (remindersEnabled=false)");
    return;
  }
  const intervalMs = Math.max(30_000, Number(cfg.reminderPollIntervalMs) || 60_000);

  try {
    await getPool();
  } catch (e) {
    logger.warn(`Reminder scheduler: DB not ready (${e.message})`);
  }

  timer = setInterval(() => {
    if (running) return;
    running = true;
    runReminderTick()
      .catch((e) => logger.error(`Reminder scheduler tick: ${e.message}`))
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  logger.info(`Proactive reminder scheduler started (every ${Math.round(intervalMs / 1000)}s)`);
  void runReminderTick();
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
