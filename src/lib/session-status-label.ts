import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Maps a TontineSession's raw status enum to a friendly, translated label —
 * shared between the member-facing session page and both admin session
 * views, so "DRAWING" never leaks to a user as a bare enum string. Mirrors
 * the actual lifecycle: DRAFT (before the draw date) → DRAWING (draw
 * unlocked, positions not yet published) → ACTIVE (positions assigned,
 * contributions collectable) → CLOSED.
 */
const SESSION_STATUS_KEY: Record<string, TranslationKey> = {
  DRAFT: "sessionStatusDraft",
  DRAWING: "sessionStatusDrawing",
  ACTIVE: "sessionStatusActive",
  CLOSED: "sessionStatusClosed",
};

export function sessionStatusKey(status: string): TranslationKey {
  return SESSION_STATUS_KEY[status] ?? "sessionStatusDraft";
}
