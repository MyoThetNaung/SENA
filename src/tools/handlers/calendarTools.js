import {
  addEvent,
  getTodayEvents,
  getUpcomingEvents,
  getEventsForLocalDate,
} from "../../calendar/calendar.js";
import { resolveEventStartsAt } from "../../calendar/resolveStartsAt.js";
import { normalizeOccurredOn } from "../../records/userRecords.js";

function formatEvents(rows) {
  if (!rows.length) return "No events found.";
  return rows
    .map((r) => {
      const d = new Date(r.starts_at);
      return `• ${d.toLocaleString()}: ${r.title}`;
    })
    .join("\n");
}

/**
 * @param {number} userId
 * @param {object} args
 */
export async function handleCalendarListEvents(userId, args) {
  const view = String(args?.view || "upcoming").toLowerCase();
  if (view === "today") {
    const rows = await getTodayEvents(userId);
    return {
      ok: true,
      data: {
        view,
        events: rows,
        text: `Today's schedule:\n${formatEvents(rows)}`,
      },
    };
  }
  if (view === "date") {
    const ymd = normalizeOccurredOn(args?.date);
    if (!ymd) {
      return {
        ok: false,
        error: 'Invalid or missing date. Use YYYY-MM-DD when view is "date".',
      };
    }
    const rows = await getEventsForLocalDate(userId, ymd);
    const head =
      rows.length === 0
        ? `No calendar events on ${ymd}.`
        : `Schedule for ${ymd}:`;
    const body = rows.length ? `\n${formatEvents(rows)}` : "";
    return {
      ok: true,
      data: { view, date: ymd, events: rows, text: `${head}${body}` },
    };
  }
  const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
  const rows = await getUpcomingEvents(userId, limit);
  return {
    ok: true,
    data: {
      view: "upcoming",
      events: rows,
      text: `Upcoming events:\n${formatEvents(rows)}`,
    },
  };
}

/**
 * @param {number} userId
 * @param {object} args
 * @param {string} [userText] Original user message for time resolution hints
 */
export async function handleCalendarAddEvent(userId, args, userText = "") {
  const title =
    String(args?.title || "")
      .trim()
      .slice(0, 500) || "Event";
  let starts =
    resolveEventStartsAt(args?.starts_at, userText) ||
    String(args?.starts_at || "").trim();
  if (!starts) {
    return {
      ok: false,
      error:
        "Could not parse event start time. Use ISO 8601 or a clear date/time.",
    };
  }
  const d = new Date(starts);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "Event start time is not valid." };
  }
  starts = d.toISOString();
  const ev = await addEvent(userId, starts, title);
  const when = new Date(ev.starts_at).toLocaleString();
  return {
    ok: true,
    data: {
      event: ev,
      text: `Added: "${ev.title}" at ${when}.`,
    },
  };
}

export function previewCalendarAddEvent(args) {
  const title = String(args?.title || "Event").trim() || "Event";
  const starts = String(args?.starts_at || "").trim();
  let whenLabel = starts;
  try {
    const d = new Date(starts);
    if (!Number.isNaN(d.getTime())) whenLabel = d.toLocaleString();
  } catch {
    /* keep raw */
  }
  return `Add calendar event "${title}" at ${whenLabel}?`;
}
