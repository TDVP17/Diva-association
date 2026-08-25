"use server";

import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

  // Persist to the user row too, so server-side flows with no request-scoped
  // cookie access (e.g. the support auto-reply bot) can still localize
  // correctly against the sender's own last-chosen language.
  const session = await auth();
  if (session?.user?.id) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { preferredLang: lang },
    });
  }
}
