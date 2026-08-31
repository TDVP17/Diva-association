import { translate, translations, type Lang, type TranslationKey } from "@/lib/i18n/translations";

/**
 * Renders an IN_APP notification's text in whichever language is CURRENTLY
 * selected, using messageKey/messageVars when present (see the Notification
 * model). Falls back to the pre-rendered `message` column for rows created
 * before messageKey existed, or for freeform admin-authored text (e.g.
 * ADMIN_BROADCAST) that has no translation key.
 */
export function renderNotificationMessage(
  n: { message: string; messageKey: string | null; messageVars: unknown },
  lang: Lang,
): string {
  if (!n.messageKey || !(n.messageKey in translations.en)) return n.message;

  const key = n.messageKey as TranslationKey;
  const vars = (n.messageVars ?? undefined) as Record<string, string> | undefined;
  const base = translate(lang, key, vars);

  // Rejection reason is appended as a separate sentence rather than baked
  // into memberRejectedMessage itself, so the base message stays a single
  // reusable key.
  if (key === "memberRejectedMessage" && vars?.reason) {
    return base + translate(lang, "memberRejectedReasonSuffix", { reason: vars.reason });
  }

  return base;
}
