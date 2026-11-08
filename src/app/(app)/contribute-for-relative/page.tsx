import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { MemberCodePayFlow } from "@/components/member-code-pay-flow";
import { ShareAppSection } from "@/components/share-app-section";

export default async function ContributeForRelativePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    const callback = code
      ? `/contribute-for-relative?code=${encodeURIComponent(code)}`
      : "/contribute-for-relative";
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}&authRequired=1`);
  }
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md lg:max-w-lg mx-auto w-full">
      <h1 className="font-title-md text-title-md text-primary mb-stack-gap-md">
        {t("contributeForRelativeNav")}
      </h1>
      <MemberCodePayFlow
        lang={lang}
        initialCode={code}
        currentUser={{ id: session.user.id, name: session.user.name, email: session.user.email }}
      />
      <ShareAppSection lang={lang} variant="card" />
    </main>
  );
}
