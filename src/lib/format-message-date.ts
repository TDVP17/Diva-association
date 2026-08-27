import { translate, type Lang } from "@/lib/i18n/translations";
import { CAMEROON_TIME_ZONE } from "@/lib/constants";

/** Stable YYYY-MM-DD key for a date in Cameroon local time — used only for same-day comparison. */
function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAMEROON_TIME_ZONE }).format(date);
}

function timeStr(date: Date): string {
  return date.toLocaleTimeString("en-GB", { timeZone: CAMEROON_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

/**
 * Human-friendly message timestamp: "Today, 14:35" / "Yesterday, 18:20" /
 * "24 August 2026, 09:15" for anything older — always in Cameroon local
 * time. `now` is injectable for testing; defaults to the real current time.
 */
export function formatMessageDate(date: Date, lang: Lang, now: Date = new Date()): string {
  const time = timeStr(date);
  const dateKeyValue = dateKey(date);

  if (dateKeyValue === dateKey(now)) {
    return `${translate(lang, "today")}, ${time}`;
  }

  // Cameroon (Africa/Douala) is a fixed UTC+1 with no DST, so subtracting
  // exactly 24h in UTC always shifts the Cameroon-local calendar day back
  // by exactly one — safe without a timezone-arithmetic library.
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dateKeyValue === dateKey(yesterday)) {
    return `${translate(lang, "yesterday")}, ${time}`;
  }

  const longDate = date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
    timeZone: CAMEROON_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${longDate}, ${time}`;
}
