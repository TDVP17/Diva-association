import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LanguageToggle } from "@/components/language-toggle";
import { MemberCodePayFlow } from "@/components/member-code-pay-flow";

/**
 * Entry point for relatives/friends contributing on a member's behalf.
 * Requires the user to be logged in before validating payment so the
 * transaction is recorded in their personal history, allowing them to
 * download their receipt PDF and share it directly via WhatsApp.
 */
export default async function PublicPayPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    const callback = code ? `/pay?code=${encodeURIComponent(code)}` : `/pay`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  }

  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-container-padding bg-background">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-2">
          <LanguageToggle currentLang={lang} />
        </div>
        <div className="text-center mb-stack-gap-lg">
          <span className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA Asso</span>
          <h1 className="font-title-md text-title-md text-on-surface mt-2">{t("contributeForMember")}</h1>
        </div>
        <MemberCodePayFlow
          lang={lang}
          payEndpoint="/api/payments/relative/initiate"
          initialCode={code}
        />
      </div>
    </main>
  );
}
