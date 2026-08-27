import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { ContributeForRelativeClient } from "./contribute-for-relative-client";

export default async function ContributeForRelativePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md lg:max-w-lg mx-auto w-full">
      <h1 className="font-title-md text-title-md text-primary mb-stack-gap-md">
        {t("contributeForRelativeNav")}
      </h1>
      <ContributeForRelativeClient lang={lang} />
    </main>
  );
}
