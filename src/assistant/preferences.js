import { getSoul, updateSoul, DEFAULT_USER_TIMEZONE } from "../memory/soul.js";
import { normalizeTimezone } from "../util/timezone.js";

const DEFAULT_ASSISTANT = {
  briefingEnabled: true,
  briefingHour: 8,
};

export async function getAssistantPreferences(userId) {
  const soul = await getSoul(userId);
  const raw =
    soul.preferences?.assistant && typeof soul.preferences.assistant === "object"
      ? soul.preferences.assistant
      : {};
  const hour = Number(raw.briefingHour);
  return {
    briefingEnabled: raw.briefingEnabled !== false,
    briefingHour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? Math.floor(hour) : DEFAULT_ASSISTANT.briefingHour,
  };
}

export async function setAssistantPreferences(userId, partial) {
  const soul = await getSoul(userId);
  const prev = await getAssistantPreferences(userId);
  const next = { ...prev };
  if (partial.briefingEnabled != null) next.briefingEnabled = Boolean(partial.briefingEnabled);
  if (partial.briefingHour != null) {
    const h = Number(partial.briefingHour);
    if (Number.isFinite(h) && h >= 0 && h <= 23) next.briefingHour = Math.floor(h);
  }
  await updateSoul(userId, {
    preferences: { ...soul.preferences, assistant: next },
  });
  return next;
}

export function getUserTimezoneFromSoul(soul) {
  const prof =
    soul?.preferences?.profile && typeof soul.preferences.profile === "object"
      ? soul.preferences.profile
      : {};
  return normalizeTimezone(prof.timezone) || DEFAULT_USER_TIMEZONE;
}

/** Local date YYYY-MM-DD and hour (0-23) for a timezone. */
export function localDateHour(now, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return { ymd, hour };
}
