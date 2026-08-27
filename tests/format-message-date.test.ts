import { describe, it, expect } from "vitest";
import { formatMessageDate } from "@/lib/format-message-date";

describe("formatMessageDate", () => {
  const now = new Date("2026-08-27T14:00:00Z"); // 15:00 Cameroon-local (UTC+1)

  it("shows 'Today, HH:MM' for a message sent earlier the same Cameroon-local day (EN)", () => {
    const date = new Date("2026-08-27T09:35:00Z"); // 10:35 Cameroon-local
    expect(formatMessageDate(date, "en", now)).toBe("Today, 10:35");
  });

  it("shows 'Aujourd'hui, HH:MM' for the same case in French", () => {
    const date = new Date("2026-08-27T09:35:00Z");
    expect(formatMessageDate(date, "fr", now)).toBe("Aujourd'hui, 10:35");
  });

  it("shows 'Yesterday, HH:MM' for a message sent the previous Cameroon-local day (EN)", () => {
    const date = new Date("2026-08-26T17:20:00Z"); // 18:20 Cameroon-local, previous day
    expect(formatMessageDate(date, "en", now)).toBe("Yesterday, 18:20");
  });

  it("shows 'Hier, HH:MM' for the same case in French", () => {
    const date = new Date("2026-08-26T17:20:00Z");
    expect(formatMessageDate(date, "fr", now)).toBe("Hier, 18:20");
  });

  it("shows a full date for anything older than yesterday (EN)", () => {
    const date = new Date("2026-08-24T08:15:00Z"); // 09:15 Cameroon-local
    expect(formatMessageDate(date, "en", now)).toBe("24 August 2026, 09:15");
  });

  it("shows a full date for anything older than yesterday (FR)", () => {
    const date = new Date("2026-08-24T08:15:00Z");
    expect(formatMessageDate(date, "fr", now)).toBe("24 août 2026, 09:15");
  });

  it("uses Cameroon-local day boundaries, not raw UTC ones — a message just after Cameroon midnight still counts as 'Today' even though its UTC calendar date is the previous day", () => {
    const nowJustAfterMidnight = new Date("2026-01-15T00:30:00Z"); // 01:30 Cameroon-local, Jan 15
    const messageJustBeforeCameroonMidnight = new Date("2026-01-14T23:45:00Z"); // 00:45 Cameroon-local, Jan 15 — same Cameroon day, but Jan 14 in UTC
    expect(formatMessageDate(messageJustBeforeCameroonMidnight, "en", nowJustAfterMidnight)).toBe("Today, 00:45");
  });
});
