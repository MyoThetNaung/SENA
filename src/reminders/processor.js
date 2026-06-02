import { query } from "../db.js";
import { getConfig } from "../config.js";
import { sendProactiveTelegramMessage } from "./telegramDelivery.js";
import { processDailyBriefings } from "../briefing/dailyBriefing.js";
import { logger } from "../logger.js";

/**
 * Calendar events entering the reminder window (starts within leadMinutes).
 */
export async function processCalendarReminders() {
  const cfg = getConfig();
  if (!cfg.remindersEnabled) return { sent: 0 };

  const lead = Math.max(1, Math.floor(Number(cfg.reminderLeadMinutes) || 15));
  const r = await query(
    `SELECT e.id, e.user_id, e.starts_at, e.title
     FROM events e
     WHERE e.starts_at > timezone('utc', now())
       AND e.starts_at <= timezone('utc', now()) + ($1::text || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM calendar_reminder_sent s
         WHERE s.event_id = e.id AND s.lead_minutes = $2
       )
     ORDER BY e.starts_at ASC
     LIMIT 100`,
    [String(lead), lead],
  );

  let sent = 0;
  for (const row of r.rows) {
    const when = new Date(row.starts_at).toLocaleString();
    const text = `Reminder: "${row.title}" starts at ${when} (in about ${lead} minutes).`;
    const out = await sendProactiveTelegramMessage({
      soulUserId: Number(row.user_id),
      text,
    });
    if (!out.ok) {
      logger.debug(`Calendar reminder skipped user ${row.user_id}: ${out.error}`);
      continue;
    }
    await query(
      `INSERT INTO calendar_reminder_sent (event_id, user_id, lead_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [Number(row.id), Number(row.user_id), lead],
    );
    sent += 1;
  }
  return { sent };
}

export async function processTaskReminders() {
  const cfg = getConfig();
  if (!cfg.remindersEnabled) return { sent: 0 };

  const lead = Math.max(1, Math.floor(Number(cfg.reminderLeadMinutes) || 15));
  const r = await query(
    `SELECT t.id, t.user_id, t.due_at, t.title
     FROM user_tasks t
     WHERE t.status = 'open'
       AND t.due_at IS NOT NULL
       AND t.due_at > timezone('utc', now())
       AND t.due_at <= timezone('utc', now()) + ($1::text || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM task_reminder_sent s
         WHERE s.task_id = t.id AND s.lead_minutes = $2
       )
     ORDER BY t.due_at ASC
     LIMIT 100`,
    [String(lead), lead],
  );

  let sent = 0;
  for (const row of r.rows) {
    const when = new Date(row.due_at).toLocaleString();
    const text = `Task reminder: "${row.title}" is due at ${when} (in about ${lead} minutes).`;
    const out = await sendProactiveTelegramMessage({
      soulUserId: Number(row.user_id),
      text,
    });
    if (!out.ok) continue;
    await query(
      `INSERT INTO task_reminder_sent (task_id, user_id, lead_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [Number(row.id), Number(row.user_id), lead],
    );
    sent += 1;
  }
  return { sent };
}

export async function runReminderTick() {
  try {
    const cal = await processCalendarReminders();
    const tasks = await processTaskReminders();
    const briefing = await processDailyBriefings();
    const total = (cal.sent || 0) + (tasks.sent || 0) + (briefing.sent || 0);
    if (total > 0) {
      logger.info(
        `Proactive messages sent: calendar=${cal.sent}, tasks=${tasks.sent}, briefing=${briefing.sent}`,
      );
    }
    return { calendar: cal.sent, tasks: tasks.sent, briefing: briefing.sent };
  } catch (e) {
    logger.error(`runReminderTick: ${e.message}`);
    return { calendar: 0, tasks: 0, briefing: 0, error: e.message };
  }
}
