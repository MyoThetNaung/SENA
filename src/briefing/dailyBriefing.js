import { getConfig } from "../config.js";
import { query } from "../db.js";
import { getSoul } from "../memory/soul.js";
import { listTasks } from "../tasks/tasks.js";
import {
  getAssistantPreferences,
  getUserTimezoneFromSoul,
  localDateHour,
} from "../assistant/preferences.js";
import { sendProactiveTelegramMessage } from "../reminders/telegramDelivery.js";
import { logger } from "../logger.js";

function formatTime(iso, timeZone) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export async function buildDailyBriefingText(userId, timeZone) {
  const uid = Number(userId);
  const tz = timeZone || "UTC";
  const { ymd } = localDateHour(new Date(), tz);

  const eventsR = await query(
    `SELECT title, starts_at FROM events
     WHERE user_id = $1
       AND (starts_at AT TIME ZONE $2)::date = $3::date
     ORDER BY starts_at ASC`,
    [uid, tz, ymd],
  );

  const openTasks = await listTasks(uid, { status: "open", limit: 50 });
  const dueToday = openTasks.filter((t) => {
    if (!t.due_at) return false;
    const d = new Date(t.due_at);
    const local = localDateHour(d, tz);
    return local.ymd === ymd;
  });
  const overdue = openTasks.filter((t) => {
    if (!t.due_at) return false;
    return new Date(t.due_at).getTime() < Date.now();
  });

  const lines = [`Good morning! Your briefing for ${ymd}:`, ""];

  lines.push("Calendar today:");
  if (!eventsR.rows.length) lines.push("• (no events)");
  else {
    for (const e of eventsR.rows) {
      lines.push(`• ${formatTime(e.starts_at, tz)} — ${e.title}`);
    }
  }

  lines.push("", "Tasks due today:");
  if (!dueToday.length) lines.push("• (none)");
  else dueToday.forEach((t) => lines.push(`• #${t.id} ${t.title}`));

  if (overdue.length) {
    lines.push("", `Overdue (${overdue.length}):`);
    overdue.slice(0, 5).forEach((t) => lines.push(`• #${t.id} ${t.title}`));
    if (overdue.length > 5) lines.push(`• …and ${overdue.length - 5} more`);
  }

  const otherOpen = openTasks.filter((t) => !dueToday.includes(t) && !overdue.includes(t));
  if (otherOpen.length) {
    lines.push("", `Other open tasks: ${otherOpen.length}`);
  }

  return lines.join("\n").slice(0, 4000);
}

export async function processDailyBriefings() {
  const cfg = getConfig();
  if (!cfg.remindersEnabled) return { sent: 0 };

  const r = await query(`SELECT user_id FROM soul ORDER BY user_id`);
  let sent = 0;

  for (const row of r.rows) {
    const userId = Number(row.user_id);
    try {
      const prefs = await getAssistantPreferences(userId);
      if (!prefs.briefingEnabled) continue;

      const soul = await getSoul(userId);
      const tz = getUserTimezoneFromSoul(soul);
      const { ymd, hour } = localDateHour(new Date(), tz);
      if (hour !== prefs.briefingHour) continue;

      const dup = await query(
        `SELECT 1 FROM daily_briefing_sent WHERE user_id = $1 AND briefing_date = $2::date LIMIT 1`,
        [userId, ymd],
      );
      if (dup.rows.length) continue;

      const text = await buildDailyBriefingText(userId, tz);
      const out = await sendProactiveTelegramMessage({ soulUserId: userId, text });
      if (!out.ok) continue;

      await query(
        `INSERT INTO daily_briefing_sent (user_id, briefing_date) VALUES ($1, $2::date)
         ON CONFLICT DO NOTHING`,
        [userId, ymd],
      );
      sent += 1;
    } catch (e) {
      logger.debug(`Daily briefing skip user ${row.user_id}: ${e.message}`);
    }
  }
  return { sent };
}
