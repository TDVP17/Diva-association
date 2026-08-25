import { cookies } from "next/headers";
import { translations, type Lang, type TranslationKey } from "./translations";
import { formatTranslation } from "./translations";

export const LANG_COOKIE = "diva_lang";

/** Reads the persisted language preference — callable from any async Server Component. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const value = store.get(LANG_COOKIE)?.value;
  return value === "fr" ? "fr" : "en";
}

/** Returns a `t(key, vars?)` translator bound to a specific language. */
export function getTranslator(lang: Lang) {
  return function t(key: TranslationKey, vars?: Record<string, string>): string {
    const template = translations[lang][key];
    return vars ? formatTranslation(template, vars) : template;
  };
}
