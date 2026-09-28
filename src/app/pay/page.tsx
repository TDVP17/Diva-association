import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LanguageToggle } from "@/components/language-toggle";
import { MemberCodePayFlow } from "@/components/member-code-pay-flow";

/**
 * Public, no-account entry point for relatives/friends contributing on a
 * member's behalf — replaces the old per-session share-link flow. Enter
 * the member's personal code, see every active cotisation cycle they still
 * owe, and pay via Fapshi. No app shell (header/back nav/bottom nav) since
 * this is meant to be opened by someone with no DIVA account at all.
 *
 * Accepts an optional `?code=DIVA0001` query parameter to auto-populate the
 * code field and immediately look up the member — this is used by the share
 * link from the MemberCodeCard component.
 */
export default async function PublicPayPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const lang = await getLang();
  const t = getTranslator(lang);
  const { code } = await searchParams;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-container-padding bg-background">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-2">
          <LanguageToggle currentLang={lang} />
        </div>
        <div className="text-center mb-stack-gap-lg">
          <span className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA Association</span>
          <h1 className="font-title-md text-title-md text-on-surface mt-2">{t("contributeForMember")}</h1>
        </div>
        <MemberCodePayFlow
          lang={lang}
          payEndpoint="/api/payments/public/pay-slot"
          initialCode={code}
        />
      </div>
    </main>
  );
}
