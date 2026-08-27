import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { translations, type Lang, type TranslationKey } from "./translations";
import { formatTranslation } from "./translations";
import { LANG_COOKIE } from "./lang-cookie";

export { LANG_COOKIE };

/**
 * Reads the persisted language preference — callable from any async Server
 * Component. The cookie is the fast path (set for a year on every toggle),
 * but a fresh browser/device with no cookie yet (e.g. logging in on a new
 * phone) falls back to the signed-in user's own `preferredLang` from the
 * database, so switching language on one device isn't forgotten on another.
 */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const cookieValue = store.get(LANG_COOKIE)?.value;
  if (cookieValue === "fr" || cookieValue === "en") return cookieValue;

  try {
    const session = await auth();
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { preferredLang: true },
      });
      if (user?.preferredLang === "fr") return "fr";
    }
  } catch {
    // Best-effort fallback only — never let this block rendering.
  }

  return "en";
}

/** Returns a `t(key, vars?)` translator bound to a specific language. */
export function getTranslator(lang: Lang) {
  return function t(key: TranslationKey, vars?: Record<string, string>): string {
    const template = translations[lang][key];
    return vars ? formatTranslation(template, vars) : template;
  };
}
