import { translate, translations, type Lang, type TranslationKey } from "@/lib/i18n/translations";

/**
 * Renders an IN_APP notification's text in whichever language is CURRENTLY
 * selected, using messageKey/messageVars when present (see the Notification
 * model). Falls back to the pre-rendered `message` column for rows created
 * before messageKey existed, or for freeform admin-authored text (e.g.
 * ADMIN_BROADCAST) that has no translation key.
 */
export function renderNotificationMessage(
  n: {
    message: string;
    messageKey: string | null;
    messageVars: unknown;
    contributionLabel?: string | null;
  },
  lang: Lang,
): string {
  let vars: Record<string, string> = {};
  if (typeof n.messageVars === "string") {
    try {
      vars = JSON.parse(n.messageVars);
    } catch {}
  } else if (typeof n.messageVars === "object" && n.messageVars !== null) {
    vars = { ...(n.messageVars as Record<string, string>) };
  }

  if (!vars.session && n.contributionLabel) {
    vars.session = n.contributionLabel;
  }
  if (!vars.cotisation && n.contributionLabel) {
    vars.cotisation = n.contributionLabel;
  }

  let text: string;
  if (n.messageKey && n.messageKey in translations[lang]) {
    const key = n.messageKey as TranslationKey;
    text = translate(lang, key, vars);

    if (key === "memberRejectedMessage" && vars?.reason) {
      text = text + translate(lang, "memberRejectedReasonSuffix", { reason: vars.reason });
    }
  } else {
    text = n.message;
  }

  // Replace any leftover placeholder {var} with values from vars or context
  text = text.replace(/\{(\w+)\}/g, (match, key) => {
    if (vars[key]) return vars[key];
    if (key === "name") return vars.name || "";
    if (key === "session" || key === "cotisation") return vars.session || vars.cotisation || n.contributionLabel || "la cotisation";
    return match;
  });

  // Clean up any awkward empty greeting punctuation
  text = text.replace(/Salut,\s*👋/g, "Salut 👋").replace(/Hello,\s*👋/g, "Hello 👋");

  return text;
}
