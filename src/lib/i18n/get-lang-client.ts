"use client";

import { LANG_COOKIE } from "./lang-cookie";
import type { Lang } from "./translations";

/**
 * Client-side counterpart to getLang() — error boundaries (error.tsx,
 * global-error.tsx) must be Client Components, so they can't await the
 * server-side cookies()/DB lookup. The diva_lang cookie is deliberately
 * non-httpOnly (see set-lang-action.ts) so it can be read here instead.
 */
export function getClientLang(): Lang {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=(en|fr)(?:;|$)`));
  return match?.[1] === "fr" ? "fr" : "en";
}
