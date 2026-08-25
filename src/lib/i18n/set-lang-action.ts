"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE } from "./get-lang";
import type { Lang } from "./translations";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLangAction(lang: Lang): Promise<void> {
  const store = await cookies();
  store.set(LANG_COOKIE, lang, {
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
}
